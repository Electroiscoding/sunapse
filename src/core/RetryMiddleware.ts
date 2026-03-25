import { getComponentLogger } from '../logging/Logger';
import { MetricsCollector } from '../metrics/MetricsCollector';
import { CircuitBreaker, CircuitState } from './CircuitBreaker';
import { apiRateLimiter } from './RateLimiter';

/**
 * RetryMiddleware - Production-grade retry logic with exponential backoff
 * 
 * Features:
 * - Configurable retry attempts
 * - Exponential backoff with jitter
 * - Circuit breaker integration
 * - Rate limiting awareness
 * - Per-error-type retry policies
 * - Request/response interceptors
 */

export interface RetryConfig {
    maxAttempts?: number;
    baseDelay?: number;
    maxDelay?: number;
    backoffMultiplier?: number;
    jitter?: boolean;
    retryableErrors?: string[];
    nonRetryableErrors?: string[];
    onRetry?: (attempt: number, error: Error, delay: number) => void;
    circuitBreaker?: CircuitBreaker;
}

export interface RetryContext {
    attempt: number;
    startTime: number;
    lastError?: Error;
}

export type RetryableFunction<T> = (context: RetryContext) => Promise<T>;

export class RetryMiddleware {
    private config: RetryConfig & { maxAttempts: number; baseDelay: number; maxDelay: number; backoffMultiplier: number; jitter: boolean; retryableErrors: string[]; nonRetryableErrors: string[] };
    private log = getComponentLogger('RetryMiddleware');
    private metrics = MetricsCollector.getInstance();

    constructor(config: Partial<RetryConfig> = {}) {
        this.config = {
            maxAttempts: config.maxAttempts ?? 3,
            baseDelay: config.baseDelay ?? 1000,
            maxDelay: config.maxDelay ?? 30000,
            backoffMultiplier: config.backoffMultiplier ?? 2,
            jitter: config.jitter ?? true,
            retryableErrors: config.retryableErrors ?? [
                'ETIMEDOUT',
                'ECONNRESET',
                'ECONNREFUSED',
                'EPIPE',
                'ENOTFOUND',
                'Network Error',
                'Timeout Error'
            ],
            nonRetryableErrors: config.nonRetryableErrors ?? [
                'Authentication Error',
                'Authorization Error',
                'Bad Request',
                'Not Found',
                'Validation Error'
            ],
            onRetry: config.onRetry,
            circuitBreaker: config.circuitBreaker
        };
    }

    /**
     * Execute function with retry logic
     */
    async execute<T>(fn: RetryableFunction<T>): Promise<T> {
        const context: RetryContext = {
            attempt: 0,
            startTime: Date.now()
        };

        while (context.attempt < this.config.maxAttempts) {
            context.attempt++;

            try {
                // Check circuit breaker if configured
                if (this.config.circuitBreaker?.getState() === CircuitState.OPEN) {
                    throw new Error('Circuit breaker is open');
                }

                // Check rate limiter (not async)
                const allowed = apiRateLimiter.checkLimit('retry');
                if (!allowed) {
                    throw new Error('Rate limit exceeded');
                }

                // Execute
                const result = await fn(context);

                // Record success
                if (context.attempt > 1) {
                    this.metrics.counter('retry_success', 1, { attempts: context.attempt.toString() });
                }

                return result;

            } catch (error) {
                context.lastError = error as Error;
                const errorMessage = (error as Error).message;

                // Check if we should retry
                if (!this.shouldRetry(errorMessage, context.attempt)) {
                    this.log.debug('Non-retryable error, giving up', { error: errorMessage });
                    throw error;
                }

                // Calculate delay
                const delay = this.calculateDelay(context.attempt);

                // Log retry
                this.log.warn(`Retry ${context.attempt}/${this.config.maxAttempts} after ${delay}ms`, {
                    error: errorMessage
                });

                this.metrics.counter('retry_attempts', 1, { attempt: context.attempt.toString() });

                // Call onRetry callback if provided
                if (this.config.onRetry) {
                    this.config.onRetry(context.attempt, error as Error, delay);
                }

                // Wait before retry
                await this.sleep(delay);
            }
        }

        // All retries exhausted
        const finalError = context.lastError || new Error('Max retries exceeded');
        this.metrics.counter('retry_exhausted', 1);
        throw finalError;
    }

    /**
     * Create a wrapped function that includes retry logic
     */
    wrap<T>(fn: () => Promise<T>): () => Promise<T> {
        return () => this.execute(() => fn());
    }

    /**
     * Check if error is retryable
     */
    private shouldRetry(errorMessage: string, attempt: number): boolean {
        const maxAttempts = this.config.maxAttempts;
        const nonRetryable = this.config.nonRetryableErrors;
        const retryable = this.config.retryableErrors;

        // Check non-retryable first
        for (const pattern of nonRetryable) {
            if (errorMessage.includes(pattern)) {
                return false;
            }
        }

        // Check retryable
        for (const pattern of retryable) {
            if (errorMessage.includes(pattern)) {
                return attempt < maxAttempts;
            }
        }

        // Default: retry if under max attempts
        return attempt < maxAttempts;
    }

    /**
     * Calculate delay with exponential backoff and jitter
     */
    private calculateDelay(attempt: number): number {
        const baseDelay = this.config.baseDelay;
        const maxDelay = this.config.maxDelay;
        const backoffMultiplier = this.config.backoffMultiplier;
        const jitter = this.config.jitter;

        // Exponential backoff
        let delay = baseDelay * Math.pow(backoffMultiplier, attempt - 1);

        // Cap at max delay
        delay = Math.min(delay, maxDelay);

        // Add jitter (random 0-30% variation)
        if (jitter) {
            const jitterAmount = delay * 0.3 * Math.random();
            delay = delay + jitterAmount;
        }

        return Math.round(delay);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * API Client with built-in retry, circuit breaker, and rate limiting
 */
export interface ApiRequest {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    headers?: Record<string, string>;
    body?: any;
    timeout?: number;
}

export interface ApiResponse<T = any> {
    status: number;
    data: T;
    headers: Record<string, string>;
}

export class ResilientApiClient {
    private retryMiddleware: RetryMiddleware;
    private circuitBreaker: CircuitBreaker;
    private log = getComponentLogger('ResilientApiClient');
    private metrics = MetricsCollector.getInstance();

    constructor(
        private baseUrl: string,
        private defaultHeaders: Record<string, string> = {},
        retryConfig?: RetryConfig
    ) {
        this.circuitBreaker = new CircuitBreaker('api-client', {
            failureThreshold: 5,
            resetTimeout: 30000
        });

        this.retryMiddleware = new RetryMiddleware({
            ...retryConfig,
            circuitBreaker: this.circuitBreaker
        });
    }

    /**
     * Make HTTP request with full resilience
     */
    async request<T = any>(req: ApiRequest): Promise<ApiResponse<T>> {
        return this.metrics.time('api_request', async () => {
            const url = req.url.startsWith('http') ? req.url : `${this.baseUrl}${req.url}`;

            const response = await this.retryMiddleware.execute(async () => {
                return this.circuitBreaker.execute(async () => {
                    // Check rate limit
                    const allowed = apiRateLimiter.checkLimit('api');
                    if (!allowed) {
                        throw new Error('Rate limit exceeded');
                    }

                    // Make request (simulated - replace with actual fetch/axios)
                    const fetchResponse = await fetch(url, {
                        method: req.method,
                        headers: { ...this.defaultHeaders, ...req.headers },
                        body: req.body ? JSON.stringify(req.body) : undefined
                    });

                    if (!fetchResponse.ok) {
                        throw new Error(`HTTP ${fetchResponse.status}: ${fetchResponse.statusText}`);
                    }

                    const data = await fetchResponse.json();

                    return {
                        status: fetchResponse.status,
                        data,
                        headers: Object.fromEntries((fetchResponse.headers as any).entries())
                    };
                });
            });

            this.metrics.counter('api_requests_success', 1, { method: req.method });
            return response;
        });
    }

    async get<T = any>(url: string, headers?: Record<string, string>): Promise<ApiResponse<T>> {
        return this.request<T>({ url, method: 'GET', headers });
    }

    async post<T = any>(url: string, body: any, headers?: Record<string, string>): Promise<ApiResponse<T>> {
        return this.request<T>({ url, method: 'POST', body, headers });
    }

    async put<T = any>(url: string, body: any, headers?: Record<string, string>): Promise<ApiResponse<T>> {
        return this.request<T>({ url, method: 'PUT', body, headers });
    }

    async delete<T = any>(url: string, headers?: Record<string, string>): Promise<ApiResponse<T>> {
        return this.request<T>({ url, method: 'DELETE', headers });
    }

    getCircuitBreaker(): CircuitBreaker {
        return this.circuitBreaker;
    }
}

// Preconfigured retry middlewares
export const apiRetryMiddleware = new RetryMiddleware({
    maxAttempts: 3,
    baseDelay: 1000,
    backoffMultiplier: 2,
    jitter: true
});

export const indexingRetryMiddleware = new RetryMiddleware({
    maxAttempts: 5,
    baseDelay: 2000,
    backoffMultiplier: 1.5,
    jitter: true
});
