import * as vscode from 'vscode';
import { StateManager } from './StateManager';

/**
 * Feature Flags System
 * Enables gradual rollouts, A/B testing, and emergency killswitches
 */

export interface FeatureFlag {
    name: string;
    enabled: boolean;
    rolloutPercentage: number;
    allowedUsers: string[];
    blockedUsers: string[];
    dependencies: string[];
    expiresAt?: number;
    metadata?: Record<string, any>;
}

export class FeatureFlagManager {
    private static instance: FeatureFlagManager;
    private flags: Map<string, FeatureFlag> = new Map();
    private stateManager: StateManager | null = null;
    private userId: string = 'default';

    private constructor() {
        this.registerDefaultFlags();
    }

    static getInstance(): FeatureFlagManager {
        if (!FeatureFlagManager.instance) {
            FeatureFlagManager.instance = new FeatureFlagManager();
        }
        return FeatureFlagManager.instance;
    }

    initialize(stateManager: StateManager, userId: string = 'default'): void {
        this.stateManager = stateManager;
        this.userId = userId;
        this.loadPersistedFlags();
    }

    private registerDefaultFlags(): void {
        // Core features
        this.registerFlag({
            name: 'multi_agent',
            enabled: true,
            rolloutPercentage: 100,
            allowedUsers: [],
            blockedUsers: [],
            dependencies: []
        });

        this.registerFlag({
            name: 'cleft_autonomous',
            enabled: false,
            rolloutPercentage: 50,
            allowedUsers: [],
            blockedUsers: [],
            dependencies: ['multi_agent']
        });

        this.registerFlag({
            name: 'advanced_indexing',
            enabled: true,
            rolloutPercentage: 100,
            allowedUsers: [],
            blockedUsers: [],
            dependencies: []
        });

        this.registerFlag({
            name: 'streaming_responses',
            enabled: true,
            rolloutPercentage: 100,
            allowedUsers: [],
            blockedUsers: [],
            dependencies: []
        });

        this.registerFlag({
            name: 'context_awareness',
            enabled: true,
            rolloutPercentage: 100,
            allowedUsers: [],
            blockedUsers: [],
            dependencies: ['advanced_indexing']
        });

        this.registerFlag({
            name: 'iteration_mode',
            enabled: false,
            rolloutPercentage: 25,
            allowedUsers: [],
            blockedUsers: [],
            dependencies: ['multi_agent', 'streaming_responses']
        });

        // Experimental features
        this.registerFlag({
            name: 'experimental_agents',
            enabled: false,
            rolloutPercentage: 5,
            allowedUsers: [],
            blockedUsers: [],
            dependencies: ['multi_agent'],
            expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
        });

        this.registerFlag({
            name: 'beta_providers',
            enabled: false,
            rolloutPercentage: 10,
            allowedUsers: [],
            blockedUsers: [],
            dependencies: [],
            expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000 // 14 days
        });
    }

    registerFlag(flag: FeatureFlag): void {
        this.flags.set(flag.name, flag);
    }

    /**
     * Check if feature is enabled for current user
     */
    isEnabled(flagName: string): boolean {
        const flag = this.flags.get(flagName);
        if (!flag) return false;

        // Check expiration
        if (flag.expiresAt && Date.now() > flag.expiresAt) {
            return false;
        }

        // Check if explicitly blocked
        if (flag.blockedUsers.includes(this.userId)) {
            return false;
        }

        // Check if explicitly allowed
        if (flag.allowedUsers.includes(this.userId)) {
            // Still need to check dependencies
            return this.checkDependencies(flag);
        }

        // Check rollout percentage
        if (flag.rolloutPercentage < 100) {
            const userHash = this.hashUserId(this.userId);
            if (userHash > flag.rolloutPercentage) {
                return false;
            }
        }

        // Check dependencies
        if (!this.checkDependencies(flag)) {
            return false;
        }

        return flag.enabled;
    }

    /**
     * Check if all dependencies are enabled
     */
    private checkDependencies(flag: FeatureFlag): boolean {
        for (const dep of flag.dependencies) {
            if (!this.isEnabled(dep)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Hash user ID to number (0-100)
     */
    private hashUserId(userId: string): number {
        let hash = 0;
        for (let i = 0; i < userId.length; i++) {
            const char = userId.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash % 100);
    }

    /**
     * Enable/disable feature
     */
    async setEnabled(flagName: string, enabled: boolean): Promise<void> {
        const flag = this.flags.get(flagName);
        if (flag) {
            flag.enabled = enabled;
            await this.persistFlags();
        }
    }

    /**
     * Set rollout percentage
     */
    async setRolloutPercentage(flagName: string, percentage: number): Promise<void> {
        const flag = this.flags.get(flagName);
        if (flag) {
            flag.rolloutPercentage = Math.max(0, Math.min(100, percentage));
            await this.persistFlags();
        }
    }

    /**
     * Add user to allowed list
     */
    async allowUser(flagName: string, userId: string): Promise<void> {
        const flag = this.flags.get(flagName);
        if (flag && !flag.allowedUsers.includes(userId)) {
            flag.allowedUsers.push(userId);
            await this.persistFlags();
        }
    }

    /**
     * Add user to blocked list
     */
    async blockUser(flagName: string, userId: string): Promise<void> {
        const flag = this.flags.get(flagName);
        if (flag && !flag.blockedUsers.includes(userId)) {
            flag.blockedUsers.push(userId);
            await this.persistFlags();
        }
    }

    /**
     * Get all flags status
     */
    getAllFlags(): Array<{
        name: string;
        enabled: boolean;
        effectiveEnabled: boolean;
        rolloutPercentage: number;
    }> {
        return Array.from(this.flags.values()).map(flag => ({
            name: flag.name,
            enabled: flag.enabled,
            effectiveEnabled: this.isEnabled(flag.name),
            rolloutPercentage: flag.rolloutPercentage
        }));
    }

    /**
     * Persist flags to storage
     */
    private async persistFlags(): Promise<void> {
        if (this.stateManager) {
            const data = Array.from(this.flags.entries());
            await this.stateManager.set('featureFlags', data);
        }
    }

    /**
     * Load persisted flags
     */
    private loadPersistedFlags(): void {
        if (this.stateManager) {
            const data = this.stateManager.get<[string, FeatureFlag][]>('featureFlags', []) || [];
            for (const [name, flag] of data) {
                this.flags.set(name, flag);
            }
        }
    }

    /**
     * Emergency kill switch - disable all features
     */
    async emergencyKill(): Promise<void> {
        for (const flag of this.flags.values()) {
            flag.enabled = false;
        }
        await this.persistFlags();

        vscode.window.showWarningMessage(
            'Synapse: Emergency kill switch activated. All features disabled.'
        );
    }

    /**
     * Reset all flags to defaults
     */
    async resetToDefaults(): Promise<void> {
        this.flags.clear();
        this.registerDefaultFlags();
        await this.persistFlags();
    }

    /**
     * Show feature flags panel
     */
    async showFeatureFlags(): Promise<void> {
        const flags = this.getAllFlags();

        const items = flags.map(f => ({
            label: `${f.effectiveEnabled ? '✓' : '✗'} ${f.name}`,
            description: `Rollout: ${f.rolloutPercentage}%`,
            detail: `Enabled: ${f.enabled}, Effective: ${f.effectiveEnabled}`,
            flag: f
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Feature Flags (click to toggle)',
            canPickMany: false
        });

        if (selected) {
            await this.setEnabled(selected.flag.name, !selected.flag.enabled);
            vscode.window.showInformationMessage(
                `${selected.flag.name} is now ${!selected.flag.enabled ? 'enabled' : 'disabled'}`
            );
        }
    }
}

// Convenience function for checking feature availability
export function isFeatureEnabled(featureName: string): boolean {
    return FeatureFlagManager.getInstance().isEnabled(featureName);
}

// Decorator for feature-gated methods
export function RequireFeature(flagName: string) {
    return function (
        target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ) {
        const originalMethod = descriptor.value;

        descriptor.value = async function (...args: any[]) {
            if (!isFeatureEnabled(flagName)) {
                throw new Error(`Feature '${flagName}' is not enabled`);
            }
            return originalMethod.apply(this, args);
        };

        return descriptor;
    };
}
