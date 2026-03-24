import * as vscode from 'vscode';
import * as assert from 'assert';
import { describe, it, before } from 'mocha';
import { StateManager } from '../../core/StateManager';

describe('Extension Test Suite', () => {
    let stateManager: StateManager;

    before(() => {
        // Mock context for testing
        const mockContext = {
            globalState: {
                get: <T>(key: string, defaultValue?: T): T | undefined => defaultValue,
                update: async () => {}
            },
            workspaceState: {
                get: <T>(key: string, defaultValue?: T): T | undefined => defaultValue,
                update: async () => {}
            },
            secrets: {
                get: async () => undefined,
                store: async () => {},
                delete: async () => {}
            }
        } as unknown as vscode.ExtensionContext;

        stateManager = new StateManager(mockContext);
    });

    it('StateManager should be defined', () => {
        assert.ok(stateManager);
    });

    it('should get and set session values', () => {
        stateManager.setSession('test-key', 'test-value');
        const value = stateManager.getSession('test-key');
        assert.strictEqual(value, 'test-value');
    });

    it('should return default value when key not found', () => {
        const value = stateManager.get('non-existent-key', 'default');
        assert.strictEqual(value, 'default');
    });

    it('should return empty array for conversation history', () => {
        const history = stateManager.getConversationHistory();
        assert.ok(Array.isArray(history));
        assert.strictEqual(history.length, 0);
    });
});
