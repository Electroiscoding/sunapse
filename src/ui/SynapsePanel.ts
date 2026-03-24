import * as vscode from 'vscode';
import { ProviderManager } from '../providers/ProviderManager';
import { AgentOrchestrator } from '../agents/AgentOrchestrator';
import { CodebaseIndex } from '../indexing/CodebaseIndex';
import { CleftEngine } from '../cleft/CleftEngine';
import { StateManager } from '../core/StateManager';
import { IterationEngine } from '../core/IterationEngine';

export class SynapsePanel {
    public static currentPanel: SynapsePanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private providerManager: ProviderManager;
    private agentOrchestrator: AgentOrchestrator;
    private codebaseIndex: CodebaseIndex;
    private cleftEngine: CleftEngine;
    private stateManager: StateManager;
    private iterationEngine: IterationEngine;

    constructor(
        context: vscode.ExtensionContext,
        providerManager: ProviderManager,
        agentOrchestrator: AgentOrchestrator,
        codebaseIndex: CodebaseIndex,
        cleftEngine: CleftEngine,
        stateManager: StateManager,
        iterationEngine: IterationEngine
    ) {
        this.providerManager = providerManager;
        this.agentOrchestrator = agentOrchestrator;
        this.codebaseIndex = codebaseIndex;
        this.cleftEngine = cleftEngine;
        this.stateManager = stateManager;
        this.iterationEngine = iterationEngine;

        this._panel = vscode.window.createWebviewPanel(
            'synapse',
            'Synapse AI',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
            }
        );

        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview, context.extensionUri);
        this._setWebviewMessageListener(this._panel.webview);

        // Handle panel close
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Listen for config changes
        vscode.workspace.onDidChangeConfiguration(
            (e: vscode.ConfigurationChangeEvent) => {
                if (e.affectsConfiguration('synapse')) {
                    this._panel.webview.postMessage({
                        type: 'configUpdated',
                        config: this._getConfig()
                    });
                }
            },
            null,
            this._disposables
        );

        SynapsePanel.currentPanel = this;
    }

    public reveal(): void {
        this._panel.reveal(vscode.ViewColumn.Two);
    }

    public onDispose(callback: () => void): void {
        this._panel.onDidDispose(callback, null, this._disposables);
    }

    public dispose(): void {
        SynapsePanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _getConfig() {
        const config = vscode.workspace.getConfiguration('synapse');
        return {
            provider: this.providerManager.getCurrentProvider(),
            model: this.providerManager.getCurrentModel(),
            hasApiKey: this.providerManager.hasApiKey(),
            maxTokens: config.get('maxTokens'),
            temperature: config.get('temperature'),
            cleftEnabled: config.get('cleft.enabled'),
            iterationEnabled: config.get('iteration.autoIterate'),
            activeAgents: config.get('agents.activeAgents')
        };
    }

    private _setWebviewMessageListener(webview: vscode.Webview): void {
        webview.onDidReceiveMessage(
            async (message: any) => {
                switch (message.type) {
                    case 'sendMessage':
                        await this._handleUserMessage(message.content, message.options);
                        break;
                    case 'getConfig':
                        webview.postMessage({
                            type: 'config',
                            config: this._getConfig()
                        });
                        break;
                    case 'indexCodebase':
                        await this.codebaseIndex.indexWorkspace();
                        webview.postMessage({ type: 'indexComplete' });
                        break;
                    case 'clearHistory':
                        await this.stateManager.clearHistory();
                        webview.postMessage({ type: 'historyCleared' });
                        break;
                    case 'startCleft':
                        await this.cleftEngine.start();
                        webview.postMessage({ type: 'cleftStarted' });
                        break;
                    case 'stopCleft':
                        await this.cleftEngine.stop();
                        webview.postMessage({ type: 'cleftStopped' });
                        break;
                    case 'switchModel':
                        await this.providerManager.switchModel();
                        webview.postMessage({
                            type: 'config',
                            config: this._getConfig()
                        });
                        break;
                    case 'addCustomAgent':
                        await this.agentOrchestrator.addCustomAgent();
                        break;
                    case 'getCodeContext':
                        const context = await this._getCodeContext();
                        webview.postMessage({
                            type: 'codeContext',
                            context
                        });
                        break;
                    case 'applyEdit':
                        await this._applyEdit(message.filePath, message.content, message.range);
                        break;
                    case 'runTerminal':
                        await this._runInTerminal(message.command);
                        break;
                    case 'startIteration':
                        await this.iterationEngine.start(message.task, message.checkpoints);
                        break;
                    case 'stopIteration':
                        await this.iterationEngine.stop();
                        break;
                    case 'restoreCheckpoint':
                        await this.iterationEngine.restoreCheckpoint(message.checkpointId);
                        break;
                }
            },
            undefined,
            this._disposables
        );
    }

    private async _handleUserMessage(content: string, options: any): Promise<void> {
        // Add user message to history
        await this.stateManager.appendToHistory({
            role: 'user',
            content
        });

        // Get relevant context from codebase index
        const relevantFiles = await this.codebaseIndex.search(content, 5);
        
        // Get current file context
        const codeContext = await this._getCodeContext();

        // Build system prompt with agent capabilities
        const systemPrompt = this.agentOrchestrator.getSystemPrompt(codeContext, relevantFiles);

        // Stream response
        const messages = [
            { role: 'system', content: systemPrompt },
            ...this.stateManager.getConversationHistory().slice(-20),
            { role: 'user', content }
        ];

        let fullResponse = '';
        
        try {
            this._panel.webview.postMessage({ type: 'responseStart' });
            
            for await (const chunk of this.providerManager.streamCompletion(messages, options)) {
                fullResponse += chunk;
                this._panel.webview.postMessage({
                    type: 'responseChunk',
                    chunk
                });
            }

            this._panel.webview.postMessage({ type: 'responseComplete' });

            // Store response
            await this.stateManager.appendToHistory({
                role: 'assistant',
                content: fullResponse
            });

            // Process any actions from the response
            await this.agentOrchestrator.processResponse(fullResponse, {
                onEdit: (edit: any) => this._panel.webview.postMessage({ type: 'suggestedEdit', edit }),
                onTerminal: (cmd: string) => this._panel.webview.postMessage({ type: 'suggestedCommand', cmd }),
                onFile: (file: any) => this._panel.webview.postMessage({ type: 'suggestedFile', file })
            });

        } catch (error) {
            this._panel.webview.postMessage({
                type: 'error',
                error: (error as Error).message
            });
        }
    }

    private async _getCodeContext(): Promise<any> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return null;
        }

        const document = editor.document;
        const selection = editor.selection;
        
        return {
            filePath: document.fileName,
            language: document.languageId,
            content: document.getText(),
            selectedText: document.getText(selection),
            cursorPosition: {
                line: selection.active.line,
                character: selection.active.character
            },
            lineCount: document.lineCount
        };
    }

    private async _applyEdit(filePath: string, content: string, range?: any): Promise<void> {
        const uri = vscode.Uri.file(filePath);
        
        try {
            let document: vscode.TextDocument;
            
            try {
                document = await vscode.workspace.openTextDocument(uri);
            } catch {
                // File doesn't exist, create it
                const edit = new vscode.WorkspaceEdit();
                edit.createFile(uri, { overwrite: false });
                await vscode.workspace.applyEdit(edit);
                document = await vscode.workspace.openTextDocument(uri);
            }

            const editor = await vscode.window.showTextDocument(document);
            
            if (range) {
                // Replace specific range
                const vscodeRange = new vscode.Range(
                    range.start.line,
                    range.start.character,
                    range.end.line,
                    range.end.character
                );
                await editor.edit((editBuilder: vscode.TextEditorEdit) => {
                    editBuilder.replace(vscodeRange, content);
                });
            } else {
                // Replace entire file
                const fullRange = new vscode.Range(
                    0,
                    0,
                    document.lineCount,
                    0
                );
                await editor.edit((editBuilder: vscode.TextEditorEdit) => {
                    editBuilder.replace(fullRange, content);
                });
            }

            await document.save();
            
            this._panel.webview.postMessage({
                type: 'editApplied',
                filePath
            });
        } catch (error) {
            this._panel.webview.postMessage({
                type: 'error',
                error: `Failed to apply edit: ${error}`
            });
        }
    }

    private async _runInTerminal(command: string): Promise<void> {
        const terminal = vscode.window.activeTerminal || vscode.window.createTerminal('Synapse');
        terminal.show();
        terminal.sendText(command);
        
        this._panel.webview.postMessage({
            type: 'terminalExecuted',
            command
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri): string {
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'styles.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
        
        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src https:;">
    <link rel="stylesheet" href="${styleUri}">
    <title>Synapse AI</title>
</head>
<body>
    <div id="root">
        <div class="synapse-container">
            <!-- Header -->
            <div class="synapse-header">
                <div class="logo">
                    <span class="logo-icon">⚡</span>
                    <span class="logo-text">Synapse</span>
                </div>
                <div class="header-actions">
                    <button class="btn-icon" id="btn-model" title="Switch Model">
                        <span>🤖</span>
                        <span class="model-indicator" id="model-indicator">...</span>
                    </button>
                    <button class="btn-icon" id="btn-index" title="Index Codebase">
                        <span>📚</span>
                    </button>
                    <button class="btn-icon" id="btn-cleft" title="Start Cleft">
                        <span>▶️</span>
                    </button>
                    <button class="btn-icon" id="btn-settings" title="Settings">
                        <span>⚙️</span>
                    </button>
                </div>
            </div>

            <!-- Agent Selector -->
            <div class="agent-bar">
                <select id="agent-select" class="agent-select">
                    <option value="auto">🎯 Auto (Orchestrator)</option>
                    <option value="coder">💻 Coder</option>
                    <option value="architect">🏗️ Architect</option>
                    <option value="debugger">🐛 Debugger</option>
                    <option value="reviewer">👁️ Reviewer</option>
                    <option value="custom">✨ Custom...</option>
                </select>
                <div class="agent-status" id="agent-status">
                    <span class="status-dot active"></span>
                    <span>Ready</span>
                </div>
            </div>

            <!-- Chat Area -->
            <div class="chat-container" id="chat-container">
                <div class="welcome-message" id="welcome-message">
                    <h2>Welcome to Synapse</h2>
                    <p>Your AI coding companion with multi-agent intelligence.</p>
                    <div class="quick-actions">
                        <button class="quick-btn" data-prompt="Explain the current file">📖 Explain code</button>
                        <button class="quick-btn" data-prompt="Refactor the selected code">✨ Refactor</button>
                        <button class="quick-btn" data-prompt="Find bugs in the current file">🐛 Find bugs</button>
                        <button class="quick-btn" data-prompt="Write tests for this code">🧪 Write tests</button>
                    </div>
                </div>
            </div>

            <!-- Input Area -->
            <div class="input-container">
                <div class="input-wrapper">
                    <textarea 
                        id="message-input" 
                        placeholder="Ask Synapse anything... (Ctrl+Enter to send)"
                        rows="1"
                    ></textarea>
                    <div class="input-actions">
                        <button class="btn-attach" id="btn-attach" title="Attach context">
                            <span>📎</span>
                        </button>
                        <button class="btn-send" id="btn-send" title="Send message">
                            <span>➤</span>
                        </button>
                    </div>
                </div>
                <div class="input-footer">
                    <span class="context-info" id="context-info">No file selected</span>
                    <label class="auto-iterate-toggle">
                        <input type="checkbox" id="auto-iterate">
                        <span>🔄 24/7 Mode</span>
                    </label>
                </div>
            </div>
        </div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
