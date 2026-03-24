import * as vscode from 'vscode';
import { StateManager } from '../core/StateManager';

/**
 * Metrics Collection and Dashboard
 * Production monitoring with counters, gauges, and histograms
 */

export interface MetricValue {
    timestamp: number;
    value: number;
    labels?: Record<string, string>;
}

export class MetricsCollector {
    private static instance: MetricsCollector;
    private counters: Map<string, number> = new Map();
    private gauges: Map<string, MetricValue[]> = new Map();
    private histograms: Map<string, number[]> = new Map();
    private outputChannel: vscode.OutputChannel;
    private reportInterval: ReturnType<typeof setInterval> | null = null;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Synapse Metrics');
    }

    static getInstance(): MetricsCollector {
        if (!MetricsCollector.instance) {
            MetricsCollector.instance = new MetricsCollector();
        }
        return MetricsCollector.instance;
    }

    /**
     * Increment a counter metric
     */
    counter(name: string, value: number = 1, labels?: Record<string, string>): void {
        const key = labels ? `${name}${JSON.stringify(labels)}` : name;
        const current = this.counters.get(key) || 0;
        this.counters.set(key, current + value);
    }

    /**
     * Record a gauge metric (point-in-time value)
     */
    gauge(name: string, value: number, labels?: Record<string, string>): void {
        const values = this.gauges.get(name) || [];
        values.push({ timestamp: Date.now(), value, labels });
        
        // Keep only last 1000 values
        if (values.length > 1000) {
            values.shift();
        }
        
        this.gauges.set(name, values);
    }

    /**
     * Record a histogram value
     */
    histogram(name: string, value: number): void {
        const values = this.histograms.get(name) || [];
        values.push(value);
        
        // Keep only last 1000 values
        if (values.length > 1000) {
            values.shift();
        }
        
        this.histograms.set(name, values);
    }

    /**
     * Time an operation and record it
     */
    async time<T>(name: string, fn: () => Promise<T>): Promise<T> {
        const start = performance.now();
        try {
            return await fn();
        } finally {
            const duration = performance.now() - start;
            this.histogram(name, duration);
        }
    }

    /**
     * Get counter value
     */
    getCounter(name: string, labels?: Record<string, string>): number {
        const key = labels ? `${name}${JSON.stringify(labels)}` : name;
        return this.counters.get(key) || 0;
    }

    /**
     * Get gauge statistics
     */
    getGaugeStats(name: string): {
        current: number | null;
        avg: number;
        min: number;
        max: number;
    } {
        const values = this.gauges.get(name) || [];
        
        if (values.length === 0) {
            return { current: null, avg: 0, min: 0, max: 0 };
        }

        const nums = values.map(v => v.value);
        const sum = nums.reduce((a, b) => a + b, 0);

        return {
            current: values[values.length - 1].value,
            avg: sum / nums.length,
            min: Math.min(...nums),
            max: Math.max(...nums)
        };
    }

    /**
     * Get histogram percentiles
     */
    getHistogramPercentiles(name: string): {
        p50: number;
        p95: number;
        p99: number;
        count: number;
    } {
        const values = this.histograms.get(name) || [];
        
        if (values.length === 0) {
            return { p50: 0, p95: 0, p99: 0, count: 0 };
        }

        const sorted = [...values].sort((a, b) => a - b);
        
        return {
            p50: this.percentile(sorted, 0.5),
            p95: this.percentile(sorted, 0.95),
            p99: this.percentile(sorted, 0.99),
            count: values.length
        };
    }

    private percentile(sorted: number[], p: number): number {
        const index = Math.ceil(sorted.length * p) - 1;
        return sorted[Math.max(0, index)];
    }

    /**
     * Start automatic metric reporting
     */
    startReporting(intervalMs: number = 60000): void {
        if (this.reportInterval) {
            clearInterval(this.reportInterval);
        }

        this.reportInterval = setInterval(() => {
            this.reportMetrics();
        }, intervalMs);
    }

    /**
     * Stop automatic reporting
     */
    stopReporting(): void {
        if (this.reportInterval) {
            clearInterval(this.reportInterval);
            this.reportInterval = null;
        }
    }

    /**
     * Report current metrics
     */
    private reportMetrics(): void {
        this.outputChannel.appendLine(`\n[${new Date().toISOString()}] Metrics Report`);
        this.outputChannel.appendLine('=' .repeat(50));

        // Report counters
        this.outputChannel.appendLine('\nCounters:');
        for (const [name, value] of this.counters) {
            this.outputChannel.appendLine(`  ${name}: ${value}`);
        }

        // Report gauge stats
        this.outputChannel.appendLine('\nGauges:');
        for (const name of this.gauges.keys()) {
            const stats = this.getGaugeStats(name);
            this.outputChannel.appendLine(
                `  ${name}: current=${stats.current}, avg=${stats.avg.toFixed(2)}`
            );
        }

        // Report histogram percentiles
        this.outputChannel.appendLine('\nHistograms:');
        for (const name of this.histograms.keys()) {
            const p = this.getHistogramPercentiles(name);
            this.outputChannel.appendLine(
                `  ${name}: p50=${p.p50.toFixed(2)}ms, p95=${p.p95.toFixed(2)}ms, p99=${p.p99.toFixed(2)}ms, n=${p.count}`
            );
        }
    }

    /**
     * Show metrics dashboard
     */
    async showDashboard(): Promise<void> {
        const lines: string[] = [
            '# Synapse Metrics Dashboard',
            `Generated: ${new Date().toLocaleString()}`,
            '',
            '## Counters',
            ...Array.from(this.counters.entries()).map(([k, v]) => `- ${k}: ${v}`),
            '',
            '## Gauges',
            ...Array.from(this.gauges.keys()).map(name => {
                const s = this.getGaugeStats(name);
                return `- ${name}: current=${s.current}, avg=${s.avg.toFixed(2)}, min=${s.min}, max=${s.max}`;
            }),
            '',
            '## Histograms (Response Times)',
            ...Array.from(this.histograms.keys()).map(name => {
                const p = this.getHistogramPercentiles(name);
                return `- ${name}: p50=${p.p50.toFixed(2)}ms, p95=${p.p95.toFixed(2)}ms, p99=${p.p99.toFixed(2)}ms`;
            })
        ];

        const doc = await vscode.workspace.openTextDocument({
            content: lines.join('\n'),
            language: 'markdown'
        });

        await vscode.window.showTextDocument(doc, { preview: true });
    }

    /**
     * Export metrics to JSON
     */
    async exportMetrics(): Promise<void> {
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`synapse_metrics_${Date.now()}.json`),
            filters: { 'JSON': ['json'] }
        });

        if (!uri) return;

        const data = {
            timestamp: Date.now(),
            counters: Object.fromEntries(this.counters),
            gauges: Object.fromEntries(
                Array.from(this.gauges.entries()).map(([k, v]) => [
                    k,
                    { stats: this.getGaugeStats(k), values: v }
                ])
            ),
            histograms: Object.fromEntries(
                Array.from(this.histograms.entries()).map(([k, v]) => [
                    k,
                    { percentiles: this.getHistogramPercentiles(k), values: v }
                ])
            )
        };

        await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(data, null, 2)));
        vscode.window.showInformationMessage(`Metrics exported to ${uri.fsPath}`);
    }

    /**
     * Reset all metrics
     */
    reset(): void {
        this.counters.clear();
        this.gauges.clear();
        this.histograms.clear();
    }

    dispose(): void {
        this.stopReporting();
        this.outputChannel.dispose();
    }
}

// Predefined metric names
export const Metrics = {
    // API metrics
    API_REQUESTS: 'api_requests_total',
    API_ERRORS: 'api_errors_total',
    API_DURATION: 'api_request_duration_ms',

    // Indexing metrics
    INDEX_FILES: 'index_files_total',
    INDEX_DURATION: 'index_duration_ms',
    INDEX_SIZE: 'index_size_bytes',

    // Agent metrics
    AGENT_RUNS: 'agent_runs_total',
    AGENT_DURATION: 'agent_duration_ms',
    AGENT_TOKENS: 'agent_tokens_total',

    // UI metrics
    UI_INTERACTIONS: 'ui_interactions_total',
    PANEL_OPENS: 'panel_opens_total'
} as const;

export const metrics = MetricsCollector.getInstance();
