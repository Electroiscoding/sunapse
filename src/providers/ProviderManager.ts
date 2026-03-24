import * as vscode from 'vscode';
import { StateManager } from '../core/StateManager';

export interface ProviderConfig {
    name: string;
    endpoint: string;
    defaultModel: string;
    requiresApiKey: boolean;
    headers: (apiKey: string) => Record<string, string>;
    formatRequest: (model: string, messages: any[], maxTokens: number, temperature: number) => any;
    parseResponse: (response: any) => string;
}

export class ProviderManager {
    private stateManager: StateManager;
    private currentProvider: string = 'openrouter';
    private currentModel: string = 'anthropic/claude-3.5-sonnet';
    private apiKey: string = '';

    private providers: Map<string, ProviderConfig> = new Map([
        ['openrouter', {
            name: 'OpenRouter',
            endpoint: 'https://openrouter.ai/api/v1/chat/completions',
            defaultModel: 'anthropic/claude-3.5-sonnet',
            requiresApiKey: true,
            headers: (apiKey) => ({
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://synapse-ai.dev',
                'X-Title': 'Synapse AI'
            }),
            formatRequest: (model, messages, maxTokens, temperature) => ({
                model,
                messages,
                max_tokens: maxTokens,
                temperature,
                stream: true
            }),
            parseResponse: (response) => response.choices?.[0]?.message?.content || ''
        }],
        ['huggingface', {
            name: 'HuggingFace',
            endpoint: 'https://api-inference.huggingface.co/models/',
            defaultModel: 'microsoft/DialoGPT-large',
            requiresApiKey: true,
            headers: (apiKey) => ({
                'Authorization': `Bearer ${apiKey}`
            }),
            formatRequest: (model, messages, maxTokens, temperature) => ({
                inputs: messages.map(m => m.content).join('\n'),
                parameters: {
                    max_new_tokens: maxTokens,
                    temperature
                }
            }),
            parseResponse: (response) => {
                if (Array.isArray(response)) {
                    return response[0]?.generated_text || '';
                }
                return response.generated_text || '';
            }
        }],
        ['openai', {
            name: 'OpenAI',
            endpoint: 'https://api.openai.com/v1/chat/completions',
            defaultModel: 'gpt-4',
            requiresApiKey: true,
            headers: (apiKey) => ({
                'Authorization': `Bearer ${apiKey}`
            }),
            formatRequest: (model, messages, maxTokens, temperature) => ({
                model,
                messages,
                max_tokens: maxTokens,
                temperature,
                stream: true
            }),
            parseResponse: (response) => response.choices?.[0]?.message?.content || ''
        }],
        ['anthropic', {
            name: 'Anthropic',
            endpoint: 'https://api.anthropic.com/v1/messages',
            defaultModel: 'claude-3-5-sonnet-20241022',
            requiresApiKey: true,
            headers: (apiKey) => ({
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            }),
            formatRequest: (model, messages, maxTokens, temperature) => ({
                model,
                messages: messages.map(m => ({
                    role: m.role,
                    content: m.content
                })),
                max_tokens: maxTokens,
                temperature
            }),
            parseResponse: (response) => response.content?.[0]?.text || ''
        }],
        ['custom', {
            name: 'Custom',
            endpoint: '',
            defaultModel: '',
            requiresApiKey: true,
            headers: (apiKey) => ({
                'Authorization': `Bearer ${apiKey}`
            }),
            formatRequest: (model, messages, maxTokens, temperature) => ({
                model,
                messages,
                max_tokens: maxTokens,
                temperature,
                stream: true
            }),
            parseResponse: (response) => response.choices?.[0]?.message?.content || response.text || ''
        }]
    ]);

    constructor(stateManager: StateManager) {
        this.stateManager = stateManager;
        this.loadConfiguration();
    }

    private async loadConfiguration(): Promise<void> {
        const config = vscode.workspace.getConfiguration('synapse');
        this.currentProvider = config.get<string>('provider', 'openrouter');
        this.currentModel = config.get<string>('model', 'anthropic/claude-3.5-sonnet');
        
        // Load API key from secure storage
        const storedKey = await this.stateManager.getSecret(`${this.currentProvider}_api_key`);
        if (storedKey) {
            this.apiKey = storedKey;
        } else {
            // Fall back to config for backward compatibility
            this.apiKey = config.get<string>('apiKey', '');
        }
    }

    getCurrentProvider(): string {
        return this.currentProvider;
    }

    getCurrentModel(): string {
        return this.currentModel;
    }

    getProviderConfig(provider?: string): ProviderConfig | undefined {
        return this.providers.get(provider || this.currentProvider);
    }

    getAllProviders(): { id: string; name: string }[] {
        return Array.from(this.providers.entries()).map(([id, config]) => ({
            id,
            name: config.name
        }));
    }

    async setProvider(providerId: string): Promise<void> {
        if (!this.providers.has(providerId)) {
            throw new Error(`Unknown provider: ${providerId}`);
        }
        
        const config = vscode.workspace.getConfiguration('synapse');
        await config.update('provider', providerId, true);
        this.currentProvider = providerId;
        
        // Load API key for new provider
        const storedKey = await this.stateManager.getSecret(`${providerId}_api_key`);
        this.apiKey = storedKey || '';
    }

    async setModel(model: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('synapse');
        await config.update('model', model, true);
        this.currentModel = model;
    }

    async setApiKey(apiKey: string): Promise<void> {
        await this.stateManager.storeSecret(`${this.currentProvider}_api_key`, apiKey);
        this.apiKey = apiKey;
    }

    hasApiKey(): boolean {
        return this.apiKey.length > 0;
    }

    async switchModel(): Promise<void> {
        const providers = this.getAllProviders();
        const config = vscode.workspace.getConfiguration('synapse');
        
        const selectedProvider = await vscode.window.showQuickPick(
            providers.map(p => ({
                label: p.name,
                description: p.id === this.currentProvider ? 'Current' : '',
                id: p.id
            })),
            { placeHolder: 'Select AI provider' }
        );
        
        if (!selectedProvider) return;

        await this.setProvider(selectedProvider.id);

        const providerConfig = this.getProviderConfig();
        
        // Prompt for model
        const model = await vscode.window.showInputBox({
            prompt: 'Enter model identifier',
            value: this.currentModel || providerConfig?.defaultModel || '',
            placeHolder: providerConfig?.defaultModel || 'e.g., anthropic/claude-3.5-sonnet'
        });
        
        if (model) {
            await this.setModel(model);
        }

        // Prompt for API key if needed
        if (providerConfig?.requiresApiKey) {
            const apiKey = await vscode.window.showInputBox({
                prompt: `Enter API key for ${providerConfig.name}`,
                password: true,
                ignoreFocusOut: true
            });
            
            if (apiKey) {
                await this.setApiKey(apiKey);
            }
        }

        // Custom endpoint for custom provider
        if (selectedProvider.id === 'custom') {
            const endpoint = await vscode.window.showInputBox({
                prompt: 'Enter custom API endpoint URL',
                value: config.get<string>('customEndpoint', ''),
                ignoreFocusOut: true
            });
            
            if (endpoint) {
                await config.update('customEndpoint', endpoint, true);
            }
        }

        vscode.window.showInformationMessage(
            `Synapse: Switched to ${providerConfig?.name} with model ${this.currentModel}`
        );
    }

    async *streamCompletion(
        messages: { role: string; content: string }[],
        options?: { maxTokens?: number; temperature?: number; model?: string }
    ): AsyncGenerator<string, void, unknown> {
        const provider = this.getProviderConfig();
        if (!provider) {
            throw new Error('No provider configured');
        }

        if (provider.requiresApiKey && !this.apiKey) {
            throw new Error(`API key required for ${provider.name}. Run "Switch AI Model" command.`);
        }

        const config = vscode.workspace.getConfiguration('synapse');
        const maxTokens = options?.maxTokens || config.get<number>('maxTokens', 4096);
        const temperature = options?.temperature || config.get<number>('temperature', 0.7);
        const model = options?.model || this.currentModel;

        let endpoint = provider.endpoint;
        if (this.currentProvider === 'custom') {
            endpoint = config.get<string>('customEndpoint', '') || endpoint;
        }
        if (this.currentProvider === 'huggingface') {
            endpoint = `${endpoint}${model}`;
        }

        const requestBody = provider.formatRequest(model, messages, maxTokens, temperature);
        
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...provider.headers(this.apiKey)
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`API error: ${response.status} - ${error}`);
            }

            // Handle streaming response
            if (requestBody.stream && response.body) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\n').filter(line => line.trim());
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]') continue;
                            
                            try {
                                const parsed = JSON.parse(data);
                                const content = parsed.choices?.[0]?.delta?.content || 
                                              parsed.choices?.[0]?.message?.content || '';
                                if (content) {
                                    yield content;
                                }
                            } catch (e) {
                                // Ignore parse errors for incomplete chunks
                            }
                        }
                    }
                }
            } else {
                // Non-streaming response
                const data = await response.json();
                const content = provider.parseResponse(data);
                yield content;
            }
        } catch (error) {
            throw new Error(`Request failed: ${error}`);
        }
    }

    async complete(
        messages: { role: string; content: string }[],
        options?: { maxTokens?: number; temperature?: number; model?: string }
    ): Promise<string> {
        let result = '';
        for await (const chunk of this.streamCompletion(messages, options)) {
            result += chunk;
        }
        return result;
    }
}
