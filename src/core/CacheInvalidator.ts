import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { StateManager } from '../core/StateManager';
import { CacheManager } from '../core/CacheManager';

/**
 * Intelligent Cache Invalidation System
 * Watches files and invalidates caches based on changes
 */

export class CacheInvalidator {
    private watchers: Map<string, vscode.FileSystemWatcher> = new Map();
    private cacheManager: CacheManager<any>;
    private stateManager: StateManager;
    private outputChannel: vscode.OutputChannel;

    constructor(
        cacheManager: CacheManager<any>,
        stateManager: StateManager
    ) {
        this.cacheManager = cacheManager;
        this.stateManager = stateManager;
        this.outputChannel = vscode.window.createOutputChannel('Synapse Cache');
    }

    /**
     * Start watching workspace for changes
     */
    watchWorkspace(): void {
        // Watch for file changes
        const pattern = '**/*.{js,ts,jsx,tsx,py,java,go,rs,c,cpp,h,hpp}';
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);

        watcher.onDidCreate((uri) => {
            this.invalidateForFile(uri.fsPath, 'created');
        });

        watcher.onDidChange((uri) => {
            this.invalidateForFile(uri.fsPath, 'changed');
        });

        watcher.onDidDelete((uri) => {
            this.invalidateForFile(uri.fsPath, 'deleted');
        });

        this.watchers.set('workspace', watcher);
        this.outputChannel.appendLine('[Cache] Started watching workspace files');
    }

    /**
     * Invalidate caches for a specific file
     */
    private invalidateForFile(filePath: string, event: string): void {
        // Invalidate file-specific caches
        const cacheKeys = this.cacheManager.keys();
        
        for (const key of cacheKeys) {
            if (key.includes(filePath) || key.includes(path.basename(filePath))) {
                this.cacheManager.delete(key);
                this.outputChannel.appendLine(`[Cache] Invalidated: ${key} (${event})`);
            }
        }

        // Invalidate related search results
        searchCache.clear();
    }

    /**
     * Invalidate all caches
     */
    invalidateAll(): void {
        this.cacheManager.clear();
        fileCache.clear();
        searchCache.clear();
        agentCache.clear();
        
        this.outputChannel.appendLine('[Cache] All caches invalidated');
    }

    /**
     * Invalidate by pattern
     */
    invalidatePattern(pattern: string): void {
        const regex = new RegExp(pattern);
        const keys = this.cacheManager.keys();

        for (const key of keys) {
            if (regex.test(key)) {
                this.cacheManager.delete(key);
            }
        }

        this.outputChannel.appendLine(`[Cache] Invalidated pattern: ${pattern}`);
    }

    /**
     * Get cache statistics
     */
    getStats(): {
        size: number;
        keys: string[];
    } {
        return {
            size: this.cacheManager.getStats().size,
            keys: this.cacheManager.keys()
        };
    }

    dispose(): void {
        for (const watcher of this.watchers.values()) {
            watcher.dispose();
        }
        this.watchers.clear();
        this.outputChannel.dispose();
    }
}

// Import specialized caches
import { fileCache, searchCache, agentCache } from './CacheManager';
