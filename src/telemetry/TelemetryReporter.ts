import * as vscode from 'vscode';

/**
 * Telemetry and Error Reporting for Synapse AI
 * 
 * Note: This is a privacy-focused telemetry system.
 * - No code content is ever sent
 * - No personally identifiable information
 * - Only feature usage and error counts
 * - Can be completely disabled via settings
 */

export interface TelemetryEvent {
    type: 'feature_used' | 'error' | 'performance' | 'provider';
    name: string;
    timestamp: number;
    duration?: number;
    metadata?: Record<string, any>;
}

export class TelemetryReporter {
    private enabled: boolean = true;
    private queue: TelemetryEvent[] = [];
    private flushInterval: ReturnType<typeof setInterval> | null = null;
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Synapse Telemetry');
        this.loadSettings();

        // Setup flush interval (every 5 minutes)
        this.flushInterval = setInterval(() => this.flush(), 5 * 60 * 1000);

        // Listen for setting changes
        vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
            if (e.affectsConfiguration('synapse.telemetry')) {
                this.loadSettings();
            }
        });
    }

    private loadSettings(): void {
        const config = vscode.workspace.getConfiguration('synapse');
        this.enabled = config.get<boolean>('telemetry.enabled', true);
    }

    /**
     * Log a feature usage event
     */
    logFeature(name: string, metadata?: Record<string, any>): void {
        if (!this.enabled) return;

        this.queue.push({
            type: 'feature_used',
            name,
            timestamp: Date.now(),
            metadata
        });
    }

    /**
     * Log an error (no stack traces or sensitive data)
     */
    logError(errorType: string, context?: string): void {
        if (!this.enabled) return;

        this.queue.push({
            type: 'error',
            name: errorType,
            timestamp: Date.now(),
            metadata: { context }
        });

        // Log to output channel for debugging
        this.outputChannel.appendLine(`[Error] ${errorType}: ${context || 'N/A'}`);
    }

    /**
     * Log performance metrics
     */
    logPerformance(operation: string, duration: number, metadata?: Record<string, any>): void {
        if (!this.enabled) return;

        this.queue.push({
            type: 'performance',
            name: operation,
            timestamp: Date.now(),
            duration,
            metadata
        });
    }

    /**
     * Log provider usage (no API keys or model names)
     */
    logProviderUsage(providerType: string, success: boolean): void {
        if (!this.enabled) return;

        this.queue.push({
            type: 'provider',
            name: providerType,
            timestamp: Date.now(),
            metadata: { success }
        });
    }

    /**
     * Flush telemetry queue
     */
    private async flush(): Promise<void> {
        if (!this.enabled || this.queue.length === 0) return;

        const events = [...this.queue];
        this.queue = [];

        try {
            // In a real implementation, this would send to a telemetry endpoint
            // For now, we just log to output channel if in debug mode
            const config = vscode.workspace.getConfiguration('synapse');
            const debugMode = config.get<boolean>('telemetry.debug', false);

            if (debugMode) {
                events.forEach(event => {
                    this.outputChannel.appendLine(`[Telemetry] ${event.type}: ${event.name}`);
                });
            }

            // Store locally for privacy
            await this.storeLocal(events);
        } catch (error) {
            // Silent fail - don't break user experience for telemetry
            console.error('Telemetry flush failed:', error);
        }
    }

    /**
     * Store telemetry events locally (privacy-first approach)
     */
    private async storeLocal(events: TelemetryEvent[]): Promise<void> {
        // In a privacy-focused implementation, we could:
        // 1. Store in local storage for user review
        // 2. Export to a local file
        // 3. Show summary in UI

        // Aggregate stats
        const stats = this.aggregateStats(events);

        // Could show monthly summary to user
        // vscode.window.showInformationMessage(`Synapse: Used ${stats.features} features this session`);
    }

    private aggregateStats(events: TelemetryEvent[]): any {
        const stats = {
            features: 0,
            errors: 0,
            operations: new Map<string, { count: number; totalDuration: number }>()
        };

        events.forEach(event => {
            switch (event.type) {
                case 'feature_used':
                    stats.features++;
                    break;
                case 'error':
                    stats.errors++;
                    break;
                case 'performance':
                    if (event.name) {
                        const existing = stats.operations.get(event.name);
                        if (existing) {
                            existing.count++;
                            existing.totalDuration += event.duration || 0;
                        } else {
                            stats.operations.set(event.name, {
                                count: 1,
                                totalDuration: event.duration || 0
                            });
                        }
                    }
                    break;
            }
        });

        return stats;
    }

    /**
     * Show telemetry summary to user
     */
    async showSummary(): Promise<void> {
        const stats = this.aggregateStats(this.queue);

        const message = `
Synapse AI Usage Summary:
- Features used: ${stats.features}
- Errors encountered: ${stats.errors}
- Average response time: ${this.getAverageResponseTime(stats)}ms
        `.trim();

        vscode.window.showInformationMessage(message);
    }

    private getAverageResponseTime(stats: any): number {
        let totalDuration = 0;
        let count = 0;

        stats.operations.forEach((op: any) => {
            if (op.count > 0) {
                totalDuration += op.totalDuration;
                count += op.count;
            }
        });

        return count > 0 ? Math.round(totalDuration / count) : 0;
    }

    /**
     * Dispose telemetry reporter
     */
    dispose(): void {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
        }
        this.flush(); // Final flush
        this.outputChannel.dispose();
    }
}

// Singleton instance
let reporter: TelemetryReporter | null = null;

export function getTelemetryReporter(): TelemetryReporter {
    if (!reporter) {
        reporter = new TelemetryReporter();
    }
    return reporter;
}

export function disposeTelemetry(): void {
    if (reporter) {
        reporter.dispose();
        reporter = null;
    }
}
