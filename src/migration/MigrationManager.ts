import * as vscode from 'vscode';
import { StateManager } from '../core/StateManager';

/**
 * Data Migration System
 * Handles schema updates and data transformations across versions
 */

export interface Migration {
    version: string;
    description: string;
    migrate: (stateManager: StateManager) => Promise<boolean>;
}

export class MigrationManager {
    private static CURRENT_VERSION = '1.0.0';
    private migrations: Migration[] = [];
    private stateManager: StateManager;

    constructor(stateManager: StateManager) {
        this.stateManager = stateManager;
        this.registerMigrations();
    }

    private registerMigrations(): void {
        // Example migrations for future versions
        this.migrations = [
            {
                version: '0.9.0',
                description: 'Initial schema setup',
                migrate: async (sm) => {
                    // Set initial version
                    await sm.set('schemaVersion', '0.9.0');
                    return true;
                }
            },
            {
                version: '1.0.0',
                description: 'v1.0 release - migrate conversation format',
                migrate: async (sm) => {
                    const conversations = sm.getConversationHistory();

                    // Add message IDs if missing
                    const migrated = conversations.map((conv: any) => ({
                        ...conv,
                        id: conv.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        timestamp: conv.timestamp || Date.now()
                    }));

                    await sm.set('conversationHistory', migrated);
                    await sm.set('schemaVersion', '1.0.0');
                    return true;
                }
            }
        ];
    }

    /**
     * Check and run necessary migrations
     */
    async migrate(): Promise<{ success: boolean; migrated: string[] }> {
        const currentVersion = this.stateManager.get<string>('schemaVersion', '0.0.0');
        const migrated: string[] = [];

        console.log(`[Migration] Current schema version: ${currentVersion}`);

        for (const migration of this.migrations) {
            // Check if this migration needs to run
            if (this.compareVersions(currentVersion || '0.0.0', migration.version) < 0) {
                console.log(`[Migration] Running: ${migration.version} - ${migration.description}`);

                try {
                    const success = await migration.migrate(this.stateManager);

                    if (success) {
                        migrated.push(migration.version);
                        console.log(`[Migration] Success: ${migration.version}`);
                    } else {
                        console.error(`[Migration] Failed: ${migration.version}`);
                        return { success: false, migrated };
                    }
                } catch (error) {
                    console.error(`[Migration] Error in ${migration.version}:`, error);
                    return { success: false, migrated };
                }
            }
        }

        if (migrated.length > 0) {
            vscode.window.showInformationMessage(
                `Synapse: Database migrated to v${MigrationManager.CURRENT_VERSION}`
            );
        }

        return { success: true, migrated };
    }

    /**
     * Compare semantic versions
     * Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2
     */
    private compareVersions(v1: string, v2: string): number {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);

        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const p1 = parts1[i] || 0;
            const p2 = parts2[i] || 0;

            if (p1 < p2) return -1;
            if (p1 > p2) return 1;
        }

        return 0;
    }

    /**
     * Get current schema version
     */
    getCurrentVersion(): string {
        return this.stateManager.get<string>('schemaVersion', '0.0.0') || '0.0.0';
    }

    /**
     * Check if migration is needed
     */
    needsMigration(): boolean {
        const current = this.getCurrentVersion();
        return this.compareVersions(current, MigrationManager.CURRENT_VERSION) < 0;
    }

    /**
     * Reset schema version (for testing)
     */
    async resetVersion(): Promise<void> {
        await this.stateManager.set('schemaVersion', '0.0.0');
    }
}
