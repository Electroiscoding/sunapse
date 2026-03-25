import { getTelemetryReporter } from '../telemetry/TelemetryReporter';

/**
 * Production-grade error handling and recovery system
 */

export enum ErrorSeverity {
    CRITICAL = 'critical',
    ERROR = 'error',
    WARNING = 'warning',
    INFO = 'info'
}

export interface ErrorContext {
    operation: string;
    component: string;
    userId?: string;
    sessionId?: string;
    metadata?: Record<string, any>;
}

export interface RecoveryStrategy {
    maxRetries: number;
    backoffMultiplier: number;
    initialDelay: number;
    shouldRetry: (error: Error, attempt: number) => boolean;
}

export class ErrorHandler {
    private static instance: ErrorHandler;
    private errorLog: Map<string, number> = new Map();
    private recoveryStrategies: Map<string, RecoveryStrategy> = new Map();
    private telemetry = getTelemetryReporter();

    private readonly DEFAULT_STRATEGY: RecoveryStrategy = {
        maxRetries: 3,
        backoffMultiplier: 2,
        initialDelay: 1000,
        shouldRetry: (error: Error, attempt: number) => {
            // Retry on network errors, rate limits, temporary failures
            const retryableErrors = [
                'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED',
                'EPIPE', 'ENOTFOUND', 'ENETUNREACH',
                '429', '503', '504'
            ];
            const message = error.message.toLowerCase();
            return (retryableErrors.some(code =>
                error.message.includes(code) ||
                (error as any).code === code
            ) || message.includes('temporary')) && attempt < 3;
        }
    };

    private constructor() {
        this.registerDefaultStrategies();
    }

    static getInstance(): ErrorHandler {
        if (!ErrorHandler.instance) {
            ErrorHandler.instance = new ErrorHandler();
        }
        return ErrorHandler.instance;
    }

    private registerDefaultStrategies(): void {
        // API call strategy
        this.recoveryStrategies.set('api', {
            maxRetries: 5,
            backoffMultiplier: 2,
            initialDelay: 1000,
            shouldRetry: (error, attempt) => {
                if (attempt >= 5) return false;
                const message = error.message.toLowerCase();
                return message.includes('rate limit') ||
                    message.includes('timeout') ||
                    message.includes('network') ||
                    message.includes('econn');
            }
        });

        // File operation strategy
        this.recoveryStrategies.set('file', {
            maxRetries: 3,
            backoffMultiplier: 1.5,
            initialDelay: 500,
            shouldRetry: (error, attempt) => {
                if (attempt >= 3) return false;
                return error.message.includes('EBUSY') ||
                    error.message.includes('EPERM') ||
                    error.message.includes('EACCES');
            }
        });

        // Indexing strategy
        this.recoveryStrategies.set('index', {
            maxRetries: 2,
            backoffMultiplier: 1,
            initialDelay: 100,
            shouldRetry: (error, attempt) => {
                return attempt < 2 && error.message.includes('memory');
            }
        });
    }

    /**
     * Execute function with error handling and recovery
     */
    async executeWithRecovery<T>(
        operation: () => Promise<T>,
        context: ErrorContext,
        strategyType: string = 'default'
    ): Promise<T> {
        const strategy = this.recoveryStrategies.get(strategyType) || this.DEFAULT_STRATEGY;
        let lastError: Error;

        for (let attempt = 0; attempt <= strategy.maxRetries; attempt++) {
            try {
                const result = await operation();

                // Log success after retry
                if (attempt > 0) {
                    this.logRecovery(context, attempt);
                }

                return result;
            } catch (error) {
                lastError = error as Error;

                // Log error
                this.logError(lastError, context, attempt);

                // Check if we should retry
                if (attempt < strategy.maxRetries &&
                    strategy.shouldRetry(lastError, attempt)) {

                    const delay = strategy.initialDelay *
                        Math.pow(strategy.backoffMultiplier, attempt);

                    this.telemetry.logPerformance('error_retry', delay, {
                        operation: context.operation,
                        attempt: attempt + 1
                    });

                    await this.sleep(delay);
                    continue;
                }

                // No more retries
                break;
            }
        }

        // All retries exhausted
        throw this.enhanceError(lastError!, context);
    }

    /**
     * Wrap a function with error boundary
     */
    withErrorBoundary<T extends (...args: any[]) => any>(
        fn: T,
        context: ErrorContext,
        fallback?: (...args: Parameters<T>) => ReturnType<T>
    ): (...args: Parameters<T>) => Promise<ReturnType<T>> {
        return async (...args: Parameters<T>): Promise<ReturnType<T>> => {
            try {
                return await fn(...args);
            } catch (error) {
                this.logError(error as Error, context, 0);

                if (fallback) {
                    return fallback(...args);
                }

                throw error;
            }
        };
    }

    /**
     * Log error with full context (public for external error reporting)
     */
    logError(error: Error, context: ErrorContext, attempt: number): void {
        const errorId = this.generateErrorId(error, context);
        const count = (this.errorLog.get(errorId) || 0) + 1;
        this.errorLog.set(errorId, count);

        const severity = this.determineSeverity(error, count);

        const errorReport = {
            id: errorId,
            severity,
            message: error.message,
            stack: error.stack,
            context,
            attempt,
            count,
            timestamp: new Date().toISOString()
        };

        // Send to telemetry
        this.telemetry.logError(context.component, `${context.operation}: ${error.message}`);

        // Log to console in development
        const isDev = typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development';
        if (isDev) {
            console.error('[Synapse Error]', errorReport);
        }
    }

    /**
     * Log successful recovery
     */
    private logRecovery(context: ErrorContext, attempts: number): void {
        this.telemetry.logFeature('error_recovery', {
            operation: context.operation,
            attempts,
            component: context.component
        });
    }

    /**
     * Enhance error with context
     */
    private enhanceError(error: Error, context: ErrorContext): Error {
        const enhanced = new Error(
            `[${context.component}] ${context.operation} failed: ${error.message}`
        );

        (enhanced as any).originalError = error;
        (enhanced as any).context = context;
        (enhanced as any).recoverable = false;

        return enhanced;
    }

    /**
     * Determine error severity based on type and frequency
     */
    private determineSeverity(error: Error, count: number): ErrorSeverity {
        if (count > 10) return ErrorSeverity.CRITICAL;
        if (error.message.includes('CRITICAL')) return ErrorSeverity.CRITICAL;
        if (error.message.includes('auth') || error.message.includes('permission')) {
            return ErrorSeverity.ERROR;
        }
        if (count > 3) return ErrorSeverity.WARNING;
        return ErrorSeverity.INFO;
    }

    /**
     * Generate unique error ID for deduplication
     */
    private generateErrorId(error: Error, context: ErrorContext): string {
        const key = `${context.component}:${context.operation}:${error.message}`;
        return key.slice(0, 100); // Limit length
    }

    /**
     * Get error statistics
     */
    getErrorStats(): { total: number; byComponent: Record<string, number> } {
        let total = 0;
        const byComponent: Record<string, number> = {};

        this.errorLog.forEach((count, key) => {
            total += count;
            const component = key.split(':')[0];
            byComponent[component] = (byComponent[component] || 0) + count;
        });

        return { total, byComponent };
    }

    /**
     * Clear error history
     */
    clearErrors(): void {
        this.errorLog.clear();
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Global error handler
export function handleUnexpectedError(error: unknown, source: string): void {
    const handler = ErrorHandler.getInstance();

    handler.executeWithRecovery(
        async () => {
            // Attempt recovery or graceful shutdown
            console.error(`Unexpected error in ${source}:`, error);
        },
        {
            operation: 'unexpected_error_handler',
            component: source,
            metadata: { error: String(error) }
        }
    ).catch(() => {
        // Final fallback
        console.error('Failed to handle unexpected error');
    });
}

// Async error wrapper
export async function safeExecute<T>(
    promise: Promise<T>,
    fallback: T,
    context: ErrorContext
): Promise<T> {
    try {
        return await promise;
    } catch (error) {
        ErrorHandler.getInstance().logError(error as Error, context, 0);
        return fallback;
    }
}
