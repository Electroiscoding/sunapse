import * as vscode from 'vscode';

export class StateManager {
    private globalState: vscode.Memento;
    private workspaceState: vscode.Memento;
    private secrets: vscode.SecretStorage;
    private sessionState: Map<string, any> = new Map();

    constructor(context: vscode.ExtensionContext) {
        this.globalState = context.globalState;
        this.workspaceState = context.workspaceState;
        this.secrets = context.secrets;
    }

    // Global state - persists across sessions
    get<T>(key: string, defaultValue?: T): T | undefined {
        return (this.globalState as any).get(key, defaultValue);
    }

    async set(key: string, value: any): Promise<void> {
        await this.globalState.update(key, value);
    }

    // Session state - in-memory only (no cold start)
    getSession<T>(key: string): T | undefined {
        return this.sessionState.get(key);
    }

    setSession<T>(key: string, value: T): void {
        this.sessionState.set(key, value);
    }

    hasSession(key: string): boolean {
        return this.sessionState.has(key);
    }

    // Secure storage for API keys
    async getSecret(key: string): Promise<string | undefined> {
        return await this.secrets.get(key);
    }

    async storeSecret(key: string, value: string): Promise<void> {
        await this.secrets.store(key, value);
    }

    async deleteSecret(key: string): Promise<void> {
        await this.secrets.delete(key);
    }

    // Conversation history management
    getConversationHistory(): any[] {
        return this.get('conversationHistory', []) || [];
    }

    async appendToHistory(entry: any): Promise<void> {
        const history = this.getConversationHistory();
        history.push({ ...entry, timestamp: Date.now() });
        // Keep only last 1000 messages
        if (history.length > 1000) {
            history.shift();
        }
        await this.set('conversationHistory', history);
    }

    async clearHistory(): Promise<void> {
        await this.set('conversationHistory', []);
    }

    // Checkpoint system for 24/7 iteration
    getCheckpoints(): any[] {
        return this.get('checkpoints', []) || [];
    }

    async saveCheckpoint(checkpoint: any): Promise<void> {
        const checkpoints = this.getCheckpoints();
        checkpoints.push({
            ...checkpoint,
            id: Date.now().toString(),
            timestamp: Date.now()
        });
        // Keep last 50 checkpoints
        if (checkpoints.length > 50) {
            checkpoints.shift();
        }
        await this.set('checkpoints', checkpoints);
    }

    async restoreCheckpoint(id: string): Promise<any | undefined> {
        const checkpoints = this.getCheckpoints();
        return checkpoints.find(cp => cp.id === id);
    }

    // Model state preservation (no cold start)
    getModelState(): any {
        return this.getSession('modelState') || this.get('persistedModelState', {});
    }

    async saveModelState(state: any): Promise<void> {
        this.setSession('modelState', state);
        await this.set('persistedModelState', state);
    }

    // Workspace-specific state
    getWorkspaceState<T>(key: string, defaultValue?: T): T | undefined {
        return (this.workspaceState as any).get(key, defaultValue);
    }

    async setWorkspaceState(key: string, value: any): Promise<void> {
        await this.workspaceState.update(key, value);
    }
}
