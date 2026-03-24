import * as vscode from 'vscode';
import * as path from 'path';
import { StateManager } from '../core/StateManager';

/**
 * Conversation Import/Export Utilities
 * Share and archive conversations
 */

export interface ConversationExport {
    version: string;
    exportedAt: number;
    conversations: Array<{
        id: string;
        timestamp: number;
        role: string;
        content: string;
        agent?: string;
        metadata?: Record<string, any>;
    }>;
    metadata: {
        totalMessages: number;
        agents: string[];
        dateRange: { start: number; end: number };
    };
}

export class ConversationIO {
    private stateManager: StateManager;

    constructor(stateManager: StateManager) {
        this.stateManager = stateManager;
    }

    /**
     * Export all conversations
     */
    async exportAll(): Promise<void> {
        const conversations = this.stateManager.getConversationHistory();
        
        if (conversations.length === 0) {
            vscode.window.showInformationMessage('No conversations to export');
            return;
        }

        const exportData: ConversationExport = {
            version: '1.0',
            exportedAt: Date.now(),
            conversations,
            metadata: {
                totalMessages: conversations.length,
                agents: [...new Set(conversations.map(c => c.agent).filter(Boolean))],
                dateRange: {
                    start: conversations[0]?.timestamp || Date.now(),
                    end: conversations[conversations.length - 1]?.timestamp || Date.now()
                }
            }
        };

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`synapse_conversations_${Date.now()}.json`),
            filters: {
                'JSON': ['json'],
                'Markdown': ['md']
            }
        });

        if (!uri) return;

        // Export as JSON
        if (uri.fsPath.endsWith('.json')) {
            await vscode.workspace.fs.writeFile(
                uri,
                Buffer.from(JSON.stringify(exportData, null, 2))
            );
        } else {
            // Export as Markdown
            const markdown = this.toMarkdown(exportData);
            await vscode.workspace.fs.writeFile(uri, Buffer.from(markdown));
        }

        vscode.window.showInformationMessage(
            `Exported ${conversations.length} conversations to ${path.basename(uri.fsPath)}`
        );
    }

    /**
     * Export single conversation thread
     */
    async exportThread(threadId: string): Promise<void> {
        const conversations = this.stateManager.getConversationHistory()
            .filter(c => c.threadId === threadId || c.id === threadId);

        if (conversations.length === 0) {
            vscode.window.showErrorMessage('Thread not found');
            return;
        }

        const exportData: ConversationExport = {
            version: '1.0',
            exportedAt: Date.now(),
            conversations,
            metadata: {
                totalMessages: conversations.length,
                agents: [...new Set(conversations.map(c => c.agent).filter(Boolean))],
                dateRange: {
                    start: conversations[0].timestamp,
                    end: conversations[conversations.length - 1].timestamp
                }
            }
        };

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`synapse_thread_${threadId.slice(0, 8)}.json`),
            filters: {
                'JSON': ['json'],
                'Markdown': ['md']
            }
        });

        if (!uri) return;

        if (uri.fsPath.endsWith('.json')) {
            await vscode.workspace.fs.writeFile(
                uri,
                Buffer.from(JSON.stringify(exportData, null, 2))
            );
        } else {
            await vscode.workspace.fs.writeFile(
                uri,
                Buffer.from(this.toMarkdown(exportData))
            );
        }

        vscode.window.showInformationMessage(
            `Exported ${conversations.length} messages to ${path.basename(uri.fsPath)}`
        );
    }

    /**
     * Import conversations from file
     */
    async importConversations(): Promise<number> {
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'JSON': ['json'],
                'All Files': ['*']
            }
        });

        if (!uris || uris.length === 0) return 0;

        try {
            const data = await vscode.workspace.fs.readFile(uris[0]);
            const exportData: ConversationExport = JSON.parse(data.toString());

            // Validate
            if (!exportData.version || !exportData.conversations) {
                throw new Error('Invalid export format');
            }

            // Confirm import
            const confirm = await vscode.window.showWarningMessage(
                `Import ${exportData.conversations.length} conversations?`,
                { modal: true },
                'Import',
                'Cancel'
            );

            if (confirm !== 'Import') return 0;

            // Import conversations
            let imported = 0;
            for (const conv of exportData.conversations) {
                await this.stateManager.appendToHistory({
                    ...conv,
                    importedAt: Date.now(),
                    originalTimestamp: conv.timestamp
                });
                imported++;
            }

            vscode.window.showInformationMessage(`Imported ${imported} conversations`);
            return imported;

        } catch (error) {
            vscode.window.showErrorMessage(`Import failed: ${error}`);
            return 0;
        }
    }

    /**
     * Convert to Markdown format
     */
    private toMarkdown(data: ConversationExport): string {
        const lines: string[] = [
            '# Synapse Conversation Export',
            '',
            `**Exported:** ${new Date(data.exportedAt).toLocaleString()}`,
            `**Total Messages:** ${data.metadata.totalMessages}`,
            `**Agents:** ${data.metadata.agents.join(', ') || 'None'}`,
            '',
            '---',
            ''
        ];

        let currentAgent = '';
        
        for (const msg of data.conversations) {
            // Group by agent
            if (msg.agent && msg.agent !== currentAgent) {
                currentAgent = msg.agent;
                lines.push(`\n## Agent: ${currentAgent}\n`);
            }

            const role = msg.role === 'user' ? '**User**' : '**Assistant**';
            const time = new Date(msg.timestamp).toLocaleString();
            
            lines.push(`### ${role} - ${time}`);
            lines.push('');
            lines.push(msg.content);
            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * Clear all conversations
     */
    async clearAll(): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            'Delete all conversation history? This cannot be undone.',
            { modal: true },
            'Delete',
            'Cancel'
        );

        if (confirm === 'Delete') {
            await this.stateManager.clearHistory();
            vscode.window.showInformationMessage('Conversation history cleared');
        }
    }

    /**
     * Archive old conversations
     */
    async archiveOld(days: number = 30): Promise<string | null> {
        const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
        const conversations = this.stateManager.getConversationHistory();
        
        const old = conversations.filter(c => c.timestamp < cutoff);
        const recent = conversations.filter(c => c.timestamp >= cutoff);

        if (old.length === 0) {
            vscode.window.showInformationMessage('No old conversations to archive');
            return null;
        }

        const archiveData: ConversationExport = {
            version: '1.0',
            exportedAt: Date.now(),
            conversations: old,
            metadata: {
                totalMessages: old.length,
                agents: [...new Set(old.map(c => c.agent).filter(Boolean))],
                dateRange: {
                    start: old[0].timestamp,
                    end: old[old.length - 1].timestamp
                }
            }
        };

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`synapse_archive_${Date.now()}.json`),
            filters: { 'JSON': ['json'] }
        });

        if (!uri) return null;

        await vscode.workspace.fs.writeFile(
            uri,
            Buffer.from(JSON.stringify(archiveData, null, 2))
        );

        // Keep only recent conversations
        await this.stateManager.set('conversationHistory', recent);

        vscode.window.showInformationMessage(
            `Archived ${old.length} conversations, kept ${recent.length} recent`
        );

        return uri.fsPath;
    }

    /**
     * Search within conversations
     */
    searchConversations(query: string): Array<{ message: any; match: string }> {
        const conversations = this.stateManager.getConversationHistory();
        const results: Array<{ message: any; match: string }> = [];
        const regex = new RegExp(query, 'gi');

        for (const conv of conversations) {
            const content = conv.content;
            const match = content.match(regex);
            
            if (match) {
                // Get context around match
                const index = content.toLowerCase().indexOf(query.toLowerCase());
                const start = Math.max(0, index - 50);
                const end = Math.min(content.length, index + query.length + 50);
                const context = content.slice(start, end);
                
                results.push({
                    message: conv,
                    match: context
                });
            }
        }

        return results;
    }
}
