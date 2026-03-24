import * as vscode from 'vscode';
import { ProviderManager } from '../providers/ProviderManager';
import { StateManager } from './StateManager';
import { ErrorHandler } from './ErrorHandler';

/**
 * Health monitoring and status checking system
 * Ensures system reliability and graceful degradation
 */

export enum HealthStatus {
    HEALTHY = 'healthy',
    DEGRADED = 'degraded',
    UNHEALTHY = 'unhealthy',
    UNKNOWN = 'unknown'
}

export interface HealthCheck {
    name: string;
    status: HealthStatus;
    message: string;
    responseTime: number;
    lastChecked: number;
    details?: Record<string, any>;
}

export interface SystemHealth {
    overall: HealthStatus;
    checks: HealthCheck[];
    uptime: number;
    version: string;
    timestamp: number;
}

export class HealthMonitor {
    private static instance: HealthMonitor;
    private checks: Map<string, () => Promise<HealthCheck>> = new Map();
    private lastCheck: SystemHealth | null = null;
    private checkInterval: ReturnType<typeof setInterval> | null = null;
    private startTime: number = Date.now();
    private outputChannel: vscode.OutputChannel;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Synapse Health');
        this.registerDefaultChecks();
    }

    static getInstance(): HealthMonitor {
        if (!HealthMonitor.instance) {
            HealthMonitor.instance = new HealthMonitor();
        }
        return HealthMonitor.instance;
    }

    /**
     * Register default health checks
     */
    private registerDefaultChecks(): void {
        // Memory usage check
        this.registerCheck('memory', async () => {
            const start = Date.now();
            const memUsage = process.memoryUsage();
            const mb = 1024 * 1024;
            
            let status = HealthStatus.HEALTHY;
            let message = 'Memory usage normal';
            
            if (memUsage.heapUsed > 500 * mb) {
                status = HealthStatus.DEGRADED;
                message = 'High memory usage detected';
            }
            if (memUsage.heapUsed > 800 * mb) {
                status = HealthStatus.UNHEALTHY;
                message = 'Critical memory usage';
            }

            return {
                name: 'memory',
                status,
                message,
                responseTime: Date.now() - start,
                lastChecked: Date.now(),
                details: {
                    heapUsed: `${(memUsage.heapUsed / mb).toFixed(2)} MB`,
                    heapTotal: `${(memUsage.heapTotal / mb).toFixed(2)} MB`,
                    rss: `${(memUsage.rss / mb).toFixed(2)} MB`
                }
            };
        });

        // API connectivity check
        this.registerCheck('api-connectivity', async () => {
            const start = Date.now();
            try {
                // Simple connectivity test
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000);
                
                await fetch('https://api.github.com', {
                    method: 'HEAD',
                    signal: controller.signal
                });
                
                clearTimeout(timeout);
                
                return {
                    name: 'api-connectivity',
                    status: HealthStatus.HEALTHY,
                    message: 'Network connectivity OK',
                    responseTime: Date.now() - start,
                    lastChecked: Date.now()
                };
            } catch {
                return {
                    name: 'api-connectivity',
                    status: HealthStatus.DEGRADED,
                    message: 'Network connectivity issues',
                    responseTime: Date.now() - start,
                    lastChecked: Date.now()
                };
            }
        });

        // Extension context check
        this.registerCheck('extension-context', async () => {
            const start = Date.now();
            const extensions = vscode.extensions.all;
            const synapseExt = extensions.find(e => e.id.includes('synapse'));
            
            return {
                name: 'extension-context',
                status: synapseExt ? HealthStatus.HEALTHY : HealthStatus.UNKNOWN,
                message: synapseExt ? 'Extension loaded correctly' : 'Extension status unknown',
                responseTime: Date.now() - start,
                lastChecked: Date.now(),
                details: {
                    totalExtensions: extensions.length,
                    synapseActive: !!synapseExt
                }
            };
        });
    }

    /**
     * Register a custom health check
     */
    registerCheck(name: string, check: () => Promise<HealthCheck>): void {
        this.checks.set(name, check);
    }

    /**
     * Run all health checks
     */
    async checkAll(): Promise<SystemHealth> {
        const start = Date.now();
        const checkResults: HealthCheck[] = [];

        for (const [name, checkFn] of this.checks) {
            try {
                const result = await Promise.race([
                    checkFn(),
                    new Promise<HealthCheck>((_, reject) => 
                        setTimeout(() => reject(new Error('Health check timeout')), 10000)
                    )
                ]);
                checkResults.push(result);
            } catch (error) {
                checkResults.push({
                    name,
                    status: HealthStatus.UNHEALTHY,
                    message: `Health check failed: ${error}`,
                    responseTime: Date.now() - start,
                    lastChecked: Date.now()
                });
            }
        }

        // Determine overall status
        const unhealthy = checkResults.filter(c => c.status === HealthStatus.UNHEALTHY).length;
        const degraded = checkResults.filter(c => c.status === HealthStatus.DEGRADED).length;

        let overall = HealthStatus.HEALTHY;
        if (unhealthy > 0) overall = HealthStatus.UNHEALTHY;
        else if (degraded > 0) overall = HealthStatus.DEGRADED;

        this.lastCheck = {
            overall,
            checks: checkResults,
            uptime: Date.now() - this.startTime,
            version: '1.0.0',
            timestamp: Date.now()
        };

        return this.lastCheck;
    }

    /**
     * Get cached health status
     */
    getStatus(): SystemHealth | null {
        return this.lastCheck;
    }

    /**
     * Check if system is healthy
     */
    isHealthy(): boolean {
        return this.lastCheck?.overall === HealthStatus.HEALTHY;
    }

    /**
     * Start periodic health monitoring
     */
    startMonitoring(intervalMs: number = 60000): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }

        this.checkInterval = setInterval(async () => {
            const health = await this.checkAll();
            
            // Log degraded/unhealthy status
            if (health.overall !== HealthStatus.HEALTHY) {
                this.outputChannel.appendLine(
                    `[${new Date().toISOString()}] Health: ${health.overall}`
                );
                
                health.checks
                    .filter(c => c.status !== HealthStatus.HEALTHY)
                    .forEach(c => {
                        this.outputChannel.appendLine(`  - ${c.name}: ${c.message}`);
                    });
            }
        }, intervalMs);
    }

    /**
     * Stop monitoring
     */
    stopMonitoring(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    /**
     * Show health status in UI
     */
    async showHealthStatus(): Promise<void> {
        const health = await this.checkAll();
        
        const statusIcon = {
            [HealthStatus.HEALTHY]: '✓',
            [HealthStatus.DEGRADED]: '⚠',
            [HealthStatus.UNHEALTHY]: '✗',
            [HealthStatus.UNKNOWN]: '?'
        };

        const messages = health.checks.map(c => 
            `${statusIcon[c.status]} ${c.name}: ${c.message} (${c.responseTime}ms)`
        );

        vscode.window.showInformationMessage(
            `Synapse Health: ${health.overall}`,
            { modal: false, detail: messages.join('\n') }
        );
    }

    /**
     * Get performance metrics
     */
    getMetrics(): {
        uptime: number;
        memory: NodeJS.MemoryUsage | null;
        health: SystemHealth | null;
    } {
        return {
            uptime: Date.now() - this.startTime,
            memory: typeof process !== 'undefined' ? process.memoryUsage() : null,
            health: this.lastCheck
        };
    }

    dispose(): void {
        this.stopMonitoring();
        this.outputChannel.dispose();
    }
}

/**
 * Graceful degradation strategies
 */
export class DegradationManager {
    private static disabledFeatures: Set<string> = new Set();
    private static degradationReasons: Map<string, string> = new Map();

    /**
     * Disable a feature due to degraded conditions
     */
    static disableFeature(feature: string, reason: string): void {
        this.disabledFeatures.add(feature);
        this.degradationReasons.set(feature, reason);
        console.warn(`[Degradation] Feature '${feature}' disabled: ${reason}`);
    }

    /**
     * Re-enable a feature
     */
    static enableFeature(feature: string): void {
        this.disabledFeatures.delete(feature);
        this.degradationReasons.delete(feature);
    }

    /**
     * Check if feature is available
     */
    static isFeatureAvailable(feature: string): { available: boolean; reason?: string } {
        if (this.disabledFeatures.has(feature)) {
            return {
                available: false,
                reason: this.degradationReasons.get(feature) || 'Feature temporarily disabled'
            };
        }
        return { available: true };
    }

    /**
     * Execute with graceful fallback
     */
    static async executeWithFallback<T>(
        feature: string,
        primary: () => Promise<T>,
        fallback: () => Promise<T>,
        errorValue?: T
    ): Promise<T> {
        const status = this.isFeatureAvailable(feature);
        
        if (!status.available) {
            console.log(`[Degradation] Using fallback for '${feature}': ${status.reason}`);
            return await fallback();
        }

        try {
            return await primary();
        } catch (error) {
            console.error(`[Degradation] Primary failed for '${feature}', using fallback:`, error);
            
            if (errorValue !== undefined) {
                return errorValue;
            }
            
            return await fallback();
        }
    }

    /**
     * Get all disabled features
     */
    static getDisabledFeatures(): Array<{ feature: string; reason: string }> {
        return Array.from(this.disabledFeatures).map(f => ({
            feature: f,
            reason: this.degradationReasons.get(f) || 'Unknown'
        }));
    }

    /**
     * Reset all degradations
     */
    static reset(): void {
        this.disabledFeatures.clear();
        this.degradationReasons.clear();
    }
}
