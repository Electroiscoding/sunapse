import * as vscode from 'vscode';
import * as path from 'path';
import { StateManager } from '../core/StateManager';
import { getTelemetryReporter } from '../telemetry/TelemetryReporter';

/**
 * Backup and Restore System
 * Protects user data with automated and manual backup capabilities
 */

export interface BackupManifest {
    id: string;
    timestamp: number;
    version: string;
    workspace: string;
    size: number;
    contents: {
        conversations: number;
        checkpoints: number;
        indexedFiles: number;
        customAgents: number;
        settings: boolean;
    };
}

export class BackupManager {
    private stateManager: StateManager;
    private context: vscode.ExtensionContext;
    private outputChannel: vscode.OutputChannel;
    private telemetry = getTelemetryReporter();
    private autoBackupInterval: ReturnType<typeof setInterval> | null = null;

    constructor(context: vscode.ExtensionContext, stateManager: StateManager) {
        this.context = context;
        this.stateManager = stateManager;
        this.outputChannel = vscode.window.createOutputChannel('Synapse Backup');
    }

    /**
     * Create a complete backup
     */
    async createBackup(): Promise<string> {
        const startTime = Date.now();
        const backupId = `backup_${Date.now()}`;
        
        try {
            // Collect all data
            const data = {
                version: '1.0.0',
                timestamp: Date.now(),
                workspace: vscode.workspace.name || 'unknown',
                conversations: this.stateManager.getConversationHistory(),
                checkpoints: this.stateManager.getCheckpoints(),
                customAgents: this.stateManager.get('customAgents', []),
                settings: this.getRelevantSettings(),
                indexStats: this.getIndexStats()
            };

            // Save to file
            const backupUri = await this.saveBackupFile(backupId, data);
            
            // Create manifest
            const manifest: BackupManifest = {
                id: backupId,
                timestamp: data.timestamp,
                version: data.version,
                workspace: data.workspace,
                size: JSON.stringify(data).length,
                contents: {
                    conversations: data.conversations.length,
                    checkpoints: data.checkpoints.length,
                    indexedFiles: data.indexStats?.totalFiles || 0,
                    customAgents: (data.customAgents || []).length,
                    settings: true
                }
            };

            // Store manifest
            await this.storeManifest(manifest);

            const duration = Date.now() - startTime;
            this.telemetry.logPerformance('backup_create', duration, {
                size: manifest.size
            });

            this.outputChannel.appendLine(`[Backup] Created: ${backupId} (${(manifest.size / 1024).toFixed(2)} KB)`);
            
            return backupId;
        } catch (error) {
            this.outputChannel.appendLine(`[Backup Error] ${error}`);
            throw error;
        }
    }

    /**
     * Restore from backup
     */
    async restoreBackup(backupId: string): Promise<boolean> {
        const startTime = Date.now();
        
        try {
            // Load backup data
            const data = await this.loadBackupFile(backupId);
            
            if (!data) {
                throw new Error(`Backup ${backupId} not found`);
            }

            // Confirm with user
            const confirm = await vscode.window.showWarningMessage(
                `Restore backup from ${new Date(data.timestamp).toLocaleString()}?\n` +
                `This will replace current conversations (${data.contents?.conversations || 0} items), ` +
                `checkpoints (${data.contents?.checkpoints || 0} items), and settings.`,
                { modal: true },
                'Restore',
                'Cancel'
            );

            if (confirm !== 'Restore') {
                return false;
            }

            // Clear current data
            await this.stateManager.clearHistory();

            // Restore conversations
            if (data.conversations) {
                for (const conv of data.conversations) {
                    await this.stateManager.appendToHistory(conv);
                }
            }

            // Restore checkpoints
            if (data.checkpoints) {
                for (const checkpoint of data.checkpoints) {
                    await this.stateManager.saveCheckpoint(checkpoint);
                }
            }

            // Restore custom agents
            if (data.customAgents) {
                await this.stateManager.set('customAgents', data.customAgents);
            }

            // Restore settings
            if (data.settings) {
                await this.restoreSettings(data.settings);
            }

            const duration = Date.now() - startTime;
            this.telemetry.logPerformance('backup_restore', duration);

            vscode.window.showInformationMessage(`Backup restored successfully: ${backupId}`);
            return true;

        } catch (error) {
            this.outputChannel.appendLine(`[Restore Error] ${error}`);
            vscode.window.showErrorMessage(`Restore failed: ${error}`);
            return false;
        }
    }

    /**
     * List all available backups
     */
    async listBackups(): Promise<BackupManifest[]> {
        const manifests = this.stateManager.get<BackupManifest[]>('backupManifests', []);
        
        // Sort by timestamp (newest first)
        return manifests.sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * Delete a backup
     */
    async deleteBackup(backupId: string): Promise<void> {
        // Remove manifest
        const manifests = this.stateManager.get<BackupManifest[]>('backupManifests', []);
        const updated = manifests.filter(m => m.id !== backupId);
        await this.stateManager.set('backupManifests', updated);

        // Delete file
        try {
            const backupPath = path.join(this.getBackupDir(), `${backupId}.json`);
            await vscode.workspace.fs.delete(vscode.Uri.file(backupPath));
        } catch {
            // File might not exist
        }

        this.outputChannel.appendLine(`[Backup] Deleted: ${backupId}`);
    }

    /**
     * Export backup to user-selected location
     */
    async exportBackup(backupId: string): Promise<void> {
        const data = await this.loadBackupFile(backupId);
        if (!data) {
            vscode.window.showErrorMessage('Backup not found');
            return;
        }

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`synapse_backup_${backupId}.json`),
            filters: {
                'JSON': ['json'],
                'All Files': ['*']
            }
        });

        if (!uri) return;

        await vscode.workspace.fs.writeFile(
            uri,
            Buffer.from(JSON.stringify(data, null, 2))
        );

        vscode.window.showInformationMessage(`Backup exported to: ${uri.fsPath}`);
    }

    /**
     * Import backup from file
     */
    async importBackup(): Promise<string | null> {
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'JSON': ['json'],
                'All Files': ['*']
            }
        });

        if (!uris || uris.length === 0) return null;

        try {
            const data = await vscode.workspace.fs.readFile(uris[0]);
            const backup = JSON.parse(data.toString());
            
            // Validate backup format
            if (!backup.version || !backup.timestamp) {
                throw new Error('Invalid backup format');
            }

            // Store as new backup
            const backupId = `imported_${Date.now()}`;
            await this.saveBackupFile(backupId, backup);

            vscode.window.showInformationMessage('Backup imported successfully');
            return backupId;

        } catch (error) {
            vscode.window.showErrorMessage(`Import failed: ${error}`);
            return null;
        }
    }

    /**
     * Start automatic backup
     */
    startAutoBackup(intervalHours: number = 24): void {
        if (this.autoBackupInterval) {
            clearInterval(this.autoBackupInterval);
        }

        const intervalMs = intervalHours * 60 * 60 * 1000;
        
        this.autoBackupInterval = setInterval(async () => {
            try {
                await this.createBackup();
                this.outputChannel.appendLine('[Auto Backup] Created successfully');
                
                // Cleanup old backups (keep last 10)
                await this.cleanupOldBackups(10);
            } catch (error) {
                this.outputChannel.appendLine(`[Auto Backup Error] ${error}`);
            }
        }, intervalMs);

        this.outputChannel.appendLine(`[Auto Backup] Started (every ${intervalHours} hours)`);
    }

    /**
     * Stop automatic backup
     */
    stopAutoBackup(): void {
        if (this.autoBackupInterval) {
            clearInterval(this.autoBackupInterval);
            this.autoBackupInterval = null;
            this.outputChannel.appendLine('[Auto Backup] Stopped');
        }
    }

    /**
     * Cleanup old backups, keeping only the most recent N
     */
    private async cleanupOldBackups(keepCount: number): Promise<void> {
        const manifests = await this.listBackups();
        
        if (manifests.length <= keepCount) return;

        const toDelete = manifests.slice(keepCount);
        
        for (const manifest of toDelete) {
            await this.deleteBackup(manifest.id);
        }

        this.outputChannel.appendLine(`[Cleanup] Removed ${toDelete.length} old backups`);
    }

    private async saveBackupFile(backupId: string, data: any): Promise<vscode.Uri> {
        const backupDir = this.getBackupDir();
        
        // Ensure directory exists
        try {
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(backupDir));
        } catch {
            // Directory might already exist
        }

        const backupPath = path.join(backupDir, `${backupId}.json`);
        const uri = vscode.Uri.file(backupPath);
        
        await vscode.workspace.fs.writeFile(
            uri,
            Buffer.from(JSON.stringify(data, null, 2))
        );

        return uri;
    }

    private async loadBackupFile(backupId: string): Promise<any> {
        try {
            const backupPath = path.join(this.getBackupDir(), `${backupId}.json`);
            const data = await vscode.workspace.fs.readFile(vscode.Uri.file(backupPath));
            return JSON.parse(data.toString());
        } catch {
            return null;
        }
    }

    private getBackupDir(): string {
        return path.join(this.context.globalStorageUri.fsPath, 'backups');
    }

    private async storeManifest(manifest: BackupManifest): Promise<void> {
        const manifests = this.stateManager.get<BackupManifest[]>('backupManifests', []);
        manifests.unshift(manifest);
        
        // Keep only last 50 manifests
        if (manifests.length > 50) {
            manifests.pop();
        }

        await this.stateManager.set('backupManifests', manifests);
    }

    private getRelevantSettings(): Record<string, any> {
        const config = vscode.workspace.getConfiguration('synapse');
        return {
            provider: config.get('provider'),
            model: config.get('model'),
            maxTokens: config.get('maxTokens'),
            temperature: config.get('temperature'),
            indexingEnabled: config.get('indexing.enabled'),
            activeAgents: config.get('agents.activeAgents')
        };
    }

    private async restoreSettings(settings: Record<string, any>): Promise<void> {
        const config = vscode.workspace.getConfiguration('synapse');
        
        for (const [key, value] of Object.entries(settings)) {
            if (value !== undefined) {
                await config.update(key, value, true);
            }
        }
    }

    private getIndexStats(): any {
        // This would be populated by CodebaseIndex
        return { totalFiles: 0 };
    }

    dispose(): void {
        this.stopAutoBackup();
        this.outputChannel.dispose();
    }
}
