import * as vscode from 'vscode';
import { StateManager } from '../core/StateManager';

/**
 * Structured Logging System
 * Production-grade logging with levels, rotation, and filtering
 */

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    FATAL = 4
}

export interface LogEntry {
    timestamp: number;
    level: LogLevel;
    levelName: string;
    component: string;
    message: string;
    metadata?: Record<string, any>;
    context?: {
        file?: string;
        line?: number;
        function?: string;
    };
}

export class Logger {
    private static instance: Logger;
    private logLevel: LogLevel = LogLevel.INFO;
    private outputChannel: vscode.OutputChannel;
    private logBuffer: LogEntry[] = [];
    private bufferSize: number = 1000;
    private subscribers: Array<(entry: LogEntry) => void> = [];

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Synapse Logs');
    }

    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * Set minimum log level
     */
    setLevel(level: LogLevel): void {
        this.logLevel = level;
    }

    /**
     * Core logging method
     */
    log(
        level: LogLevel,
        component: string,
        message: string,
        metadata?: Record<string, any>
    ): void {
        if (level < this.logLevel) {
            return;
        }

        const entry: LogEntry = {
            timestamp: Date.now(),
            level,
            levelName: LogLevel[level],
            component,
            message,
            metadata,
            context: this.getContext()
        };

        // Add to buffer
        this.logBuffer.push(entry);
        if (this.logBuffer.length > this.bufferSize) {
            this.logBuffer.shift();
        }

        // Output to channel
        this.outputToChannel(entry);

        // Notify subscribers
        for (const subscriber of this.subscribers) {
            try {
                subscriber(entry);
            } catch {
                // Ignore subscriber errors
            }
        }

        // Fatal logs get special handling
        if (level === LogLevel.FATAL) {
            this.handleFatal(entry);
        }
    }

    /**
     * Log methods for each level
     */
    debug(component: string, message: string, metadata?: Record<string, any>): void {
        this.log(LogLevel.DEBUG, component, message, metadata);
    }

    info(component: string, message: string, metadata?: Record<string, any>): void {
        this.log(LogLevel.INFO, component, message, metadata);
    }

    warn(component: string, message: string, metadata?: Record<string, any>): void {
        this.log(LogLevel.WARN, component, message, metadata);
    }

    error(component: string, message: string, metadata?: Record<string, any>): void {
        this.log(LogLevel.ERROR, component, message, metadata);
    }

    fatal(component: string, message: string, metadata?: Record<string, any>): void {
        this.log(LogLevel.FATAL, component, message, metadata);
    }

    /**
     * Format and output log entry
     */
    private outputToChannel(entry: LogEntry): void {
        const time = new Date(entry.timestamp).toISOString().split('T')[1].slice(0, -1);
        const level = entry.levelName.padEnd(5);
        const component = entry.component.padEnd(20);
        
        let line = `[${time}] [${level}] [${component}] ${entry.message}`;

        if (entry.metadata && Object.keys(entry.metadata).length > 0) {
            const metaStr = Object.entries(entry.metadata)
                .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                .join(' ');
            line += ` | ${metaStr}`;
        }

        this.outputChannel.appendLine(line);
    }

    /**
     * Get call context
     */
    private getContext(): LogEntry['context'] {
        const stack = new Error().stack;
        if (!stack) return undefined;

        const lines = stack.split('\n');
        // Find the caller (skip this method and the public log method)
        const callerLine = lines[4] || lines[3];
        
        if (callerLine) {
            const match = callerLine.match(/at\s+(\w+)\s+\((.+):(\d+):(\d+)\)/);
            if (match) {
                return {
                    function: match[1],
                    file: match[2].split('/').pop(),
                    line: parseInt(match[3], 10)
                };
            }
        }

        return undefined;
    }

    /**
     * Handle fatal errors
     */
    private handleFatal(entry: LogEntry): void {
        vscode.window.showErrorMessage(
            `FATAL ERROR in ${entry.component}: ${entry.message}`,
            { modal: true }
        );
    }

    /**
     * Subscribe to log events
     */
    subscribe(callback: (entry: LogEntry) => void): () => void {
        this.subscribers.push(callback);
        
        return () => {
            const index = this.subscribers.indexOf(callback);
            if (index !== -1) {
                this.subscribers.splice(index, 1);
            }
        };
    }

    /**
     * Get recent logs
     */
    getRecent(count: number = 100, level?: LogLevel): LogEntry[] {
        let logs = this.logBuffer;
        
        if (level !== undefined) {
            logs = logs.filter(l => l.level >= level);
        }

        return logs.slice(-count);
    }

    /**
     * Export logs to file
     */
    async exportLogs(): Promise<void> {
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`synapse_logs_${Date.now()}.json`),
            filters: { 'JSON': ['json'] }
        });

        if (!uri) return;

        const data = JSON.stringify(this.logBuffer, null, 2);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(data));
        
        vscode.window.showInformationMessage(`Logs exported to ${uri.fsPath}`);
    }

    /**
     * Clear all logs
     */
    clear(): void {
        this.logBuffer = [];
        this.outputChannel.clear();
    }

    /**
     * Show logs panel
     */
    show(): void {
        this.outputChannel.show();
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}

// Component loggers
export function getComponentLogger(component: string) {
    const logger = Logger.getInstance();
    
    return {
        debug: (msg: string, meta?: Record<string, any>) => logger.debug(component, msg, meta),
        info: (msg: string, meta?: Record<string, any>) => logger.info(component, msg, meta),
        warn: (msg: string, meta?: Record<string, any>) => logger.warn(component, msg, meta),
        error: (msg: string, meta?: Record<string, any>) => logger.error(component, msg, meta),
        fatal: (msg: string, meta?: Record<string, any>) => logger.fatal(component, msg, meta)
    };
}

// Global logger instance
export const logger = Logger.getInstance();
