import * as vscode from 'vscode';
import { getTelemetryReporter } from '../telemetry/TelemetryReporter';

/**
 * Performance profiling and monitoring system
 * Tracks execution times, memory usage, and bottlenecks
 */

export interface PerformanceMetric {
    name: string;
    startTime: number;
    endTime: number;
    duration: number;
    memoryDelta: number;
    metadata?: Record<string, any>;
}

export interface PerformanceProfile {
    id: string;
    name: string;
    startTime: number;
    endTime?: number;
    metrics: PerformanceMetric[];
    totalDuration: number;
    peakMemory: number;
}

export class PerformanceProfiler {
    private static instance: PerformanceProfiler;
    private activeProfiles: Map<string, PerformanceProfile> = new Map();
    private completedProfiles: PerformanceProfile[] = [];
    private maxHistory: number = 100;
    private outputChannel: vscode.OutputChannel;
    private telemetry = getTelemetryReporter();

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Synapse Performance');
    }

    static getInstance(): PerformanceProfiler {
        if (!PerformanceProfiler.instance) {
            PerformanceProfiler.instance = new PerformanceProfiler();
        }
        return PerformanceProfiler.instance;
    }

    /**
     * Start a new performance profile
     */
    startProfile(name: string): string {
        const id = `${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const profile: PerformanceProfile = {
            id,
            name,
            startTime: Date.now(),
            metrics: [],
            totalDuration: 0,
            peakMemory: 0
        };

        this.activeProfiles.set(id, profile);
        return id;
    }

    /**
     * Start timing a metric within a profile
     */
    startMetric(profileId: string, name: string, metadata?: Record<string, any>): () => void {
        const profile = this.activeProfiles.get(profileId);
        if (!profile) {
            return () => {};
        }

        const startTime = performance.now();
        const startMemory = this.getMemoryUsage();

        // Return end function
        return () => {
            const endTime = performance.now();
            const endMemory = this.getMemoryUsage();

            const metric: PerformanceMetric = {
                name,
                startTime,
                endTime,
                duration: endTime - startTime,
                memoryDelta: endMemory - startMemory,
                metadata
            };

            profile.metrics.push(metric);
            
            // Update peak memory
            if (endMemory > profile.peakMemory) {
                profile.peakMemory = endMemory;
            }

            // Log slow operations (> 1 second)
            if (metric.duration > 1000) {
                this.outputChannel.appendLine(
                    `[SLOW] ${name}: ${metric.duration.toFixed(2)}ms` +
                    (metadata ? ` | ${JSON.stringify(metadata)}` : '')
                );
            }
        };
    }

    /**
     * End a profile and store results
     */
    endProfile(profileId: string): PerformanceProfile | null {
        const profile = this.activeProfiles.get(profileId);
        if (!profile) return null;

        profile.endTime = Date.now();
        profile.totalDuration = profile.endTime - profile.startTime;

        this.activeProfiles.delete(profileId);
        this.completedProfiles.push(profile);

        // Maintain history limit
        if (this.completedProfiles.length > this.maxHistory) {
            this.completedProfiles = this.completedProfiles.slice(-this.maxHistory);
        }

        // Report to telemetry
        this.telemetry.logPerformance('profile_complete', profile.totalDuration, {
            name: profile.name,
            metricCount: profile.metrics.length,
            peakMemory: profile.peakMemory
        });

        return profile;
    }

    /**
     * Execute function with automatic profiling
     */
    async profile<T>(
        name: string,
        fn: () => Promise<T>,
        metadata?: Record<string, any>
    ): Promise<T> {
        const profileId = this.startProfile(name);
        const endMetric = this.startMetric(profileId, 'total_execution', metadata);

        try {
            const result = await fn();
            return result;
        } finally {
            endMetric();
            this.endProfile(profileId);
        }
    }

    /**
     * Get current memory usage
     */
    private getMemoryUsage(): number {
        if (typeof process !== 'undefined' && process.memoryUsage) {
            return process.memoryUsage().heapUsed;
        }
        return 0;
    }

    /**
     * Get performance statistics
     */
    getStats(): {
        activeProfiles: number;
        completedProfiles: number;
        averageDuration: number;
        slowestOperations: Array<{ name: string; avgDuration: number }>;
    } {
        const completed = this.completedProfiles;
        
        // Calculate average duration
        const avgDuration = completed.length > 0
            ? completed.reduce((sum, p) => sum + p.totalDuration, 0) / completed.length
            : 0;

        // Find slowest operations
        const operationTimes: Map<string, number[]> = new Map();
        
        for (const profile of completed) {
            for (const metric of profile.metrics) {
                if (!operationTimes.has(metric.name)) {
                    operationTimes.set(metric.name, []);
                }
                operationTimes.get(metric.name)!.push(metric.duration);
            }
        }

        const slowestOperations = Array.from(operationTimes.entries())
            .map(([name, times]) => ({
                name,
                avgDuration: times.reduce((a, b) => a + b, 0) / times.length
            }))
            .sort((a, b) => b.avgDuration - a.avgDuration)
            .slice(0, 10);

        return {
            activeProfiles: this.activeProfiles.size,
            completedProfiles: completed.length,
            averageDuration: avgDuration,
            slowestOperations
        };
    }

    /**
     * Show performance report
     */
    async showReport(): Promise<void> {
        const stats = this.getStats();
        
        const report = `
Synapse Performance Report
==========================

Active Profiles: ${stats.activeProfiles}
Completed Profiles: ${stats.completedProfiles}
Average Duration: ${stats.averageDuration.toFixed(2)}ms

Slowest Operations:
${stats.slowestOperations.map((op, i) => 
    `${i + 1}. ${op.name}: ${op.avgDuration.toFixed(2)}ms`
).join('\n')}
        `.trim();

        const doc = await vscode.workspace.openTextDocument({
            content: report,
            language: 'markdown'
        });

        await vscode.window.showTextDocument(doc, { preview: true });
    }

    /**
     * Clear all profiles
     */
    clear(): void {
        this.activeProfiles.clear();
        this.completedProfiles = [];
    }

    dispose(): void {
        this.clear();
        this.outputChannel.dispose();
    }
}

/**
 * Decorator for automatic method profiling
 */
export function ProfileMethod(name?: string) {
    return function (
        target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ) {
        const originalMethod = descriptor.value;
        const methodName = name || propertyKey;

        descriptor.value = async function (...args: any[]) {
            const profiler = PerformanceProfiler.getInstance();
            return profiler.profile(
                methodName,
                () => originalMethod.apply(this, args),
                { args: args.length }
            );
        };

        return descriptor;
    };
}

/**
 * Memory leak detection
 */
export class MemoryLeakDetector {
    private snapshots: Array<{ timestamp: number; memory: number }> = [];
    private maxSnapshots: number = 50;
    private checkInterval: ReturnType<typeof setInterval> | null = null;

    startMonitoring(intervalMs: number = 30000): void {
        this.checkInterval = setInterval(() => {
            const memory = this.getMemoryUsage();
            this.snapshots.push({
                timestamp: Date.now(),
                memory
            });

            if (this.snapshots.length > this.maxSnapshots) {
                this.snapshots = this.snapshots.slice(-this.maxSnapshots);
            }

            this.detectLeaks();
        }, intervalMs);
    }

    stopMonitoring(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    private getMemoryUsage(): number {
        if (typeof process !== 'undefined' && process.memoryUsage) {
            return process.memoryUsage().heapUsed;
        }
        return 0;
    }

    private detectLeaks(): void {
        if (this.snapshots.length < 10) return;

        const recent = this.snapshots.slice(-10);
        const first = recent[0].memory;
        const last = recent[recent.length - 1].memory;
        
        // Check for consistent growth > 50% over 10 samples
        if (last > first * 1.5) {
            console.warn('[MemoryLeakDetector] Potential memory leak detected:', {
                growth: `${((last - first) / 1024 / 1024).toFixed(2)} MB`,
                percentage: `${((last / first - 1) * 100).toFixed(1)}%`
            });
        }
    }

    getSnapshots(): typeof this.snapshots {
        return [...this.snapshots];
    }
}
