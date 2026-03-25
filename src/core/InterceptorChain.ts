import { getComponentLogger } from '../logging/Logger';
import { MetricsCollector } from '../metrics/MetricsCollector';

/**
 * InterceptorChain - Production-grade request/response interceptors
 * 
 * Features:
 * - Request/response transformation pipeline
 * - Middleware pattern with next() callbacks
 * - Priority-based ordering
 * - Error handling at each stage
 * - Conditional execution
 * - Interceptor composition
 */

export interface RequestContext {
    id: string;
    timestamp: number;
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: any;
    metadata: Record<string, any>;
}

export interface ResponseContext {
    id: string;
    requestId: string;
    timestamp: number;
    status: number;
    headers: Record<string, string>;
    body?: any;
    duration: number;
    metadata: Record<string, any>;
}

export interface Interceptor {
    name: string;
    priority: number;
    condition?: (context: RequestContext | ResponseContext) => boolean;
}

export interface RequestInterceptor extends Interceptor {
    intercept: (context: RequestContext, next: () => Promise<RequestContext>) => Promise<RequestContext>;
}

export interface ResponseInterceptor extends Interceptor {
    intercept: (context: ResponseContext, next: () => Promise<ResponseContext>) => Promise<ResponseContext>;
}

export interface ErrorInterceptor extends Interceptor {
    intercept: (error: Error, context: RequestContext, next: () => Promise<void>) => Promise<void>;
}

export class InterceptorChain {
    private requestInterceptors: RequestInterceptor[] = [];
    private responseInterceptors: ResponseInterceptor[] = [];
    private errorInterceptors: ErrorInterceptor[] = [];
    private log = getComponentLogger('InterceptorChain');
    private metrics = MetricsCollector.getInstance();

    /**
     * Register a request interceptor
     */
    addRequestInterceptor(interceptor: RequestInterceptor): void {
        this.requestInterceptors.push(interceptor);
        this.requestInterceptors.sort((a, b) => a.priority - b.priority);
        this.log.info(`Added request interceptor: ${interceptor.name} (priority: ${interceptor.priority})`);
    }

    /**
     * Register a response interceptor
     */
    addResponseInterceptor(interceptor: ResponseInterceptor): void {
        this.responseInterceptors.push(interceptor);
        this.responseInterceptors.sort((a, b) => a.priority - b.priority);
        this.log.info(`Added response interceptor: ${interceptor.name} (priority: ${interceptor.priority})`);
    }

    /**
     * Register an error interceptor
     */
    addErrorInterceptor(interceptor: ErrorInterceptor): void {
        this.errorInterceptors.push(interceptor);
        this.errorInterceptors.sort((a, b) => a.priority - b.priority);
        this.log.info(`Added error interceptor: ${interceptor.name} (priority: ${interceptor.priority})`);
    }

    /**
     * Remove an interceptor by name
     */
    removeInterceptor(name: string): void {
        this.requestInterceptors = this.requestInterceptors.filter(i => i.name !== name);
        this.responseInterceptors = this.responseInterceptors.filter(i => i.name !== name);
        this.errorInterceptors = this.errorInterceptors.filter(i => i.name !== name);
        this.log.info(`Removed interceptor: ${name}`);
    }

    /**
     * Execute request through interceptor chain
     */
    async executeRequest(
        request: RequestContext,
        handler: (req: RequestContext) => Promise<ResponseContext>
    ): Promise<ResponseContext> {
        const startTime = Date.now();

        try {
            // Execute request interceptors
            const processedRequest = await this.runRequestInterceptors(request);

            // Execute actual request
            let response = await handler(processedRequest);
            response.requestId = processedRequest.id;
            response.duration = Date.now() - startTime;

            // Execute response interceptors
            const processedResponse = await this.runResponseInterceptors(response);

            this.metrics.counter('interceptor_requests_success', 1);

            return processedResponse;

        } catch (error) {
            // Execute error interceptors
            await this.runErrorInterceptors(error as Error, request);

            this.metrics.counter('interceptor_requests_error', 1);
            throw error;
        }
    }

    /**
     * Get interceptor statistics
     */
    getStats(): {
        requestInterceptors: number;
        responseInterceptors: number;
        errorInterceptors: number;
        total: number;
    } {
        return {
            requestInterceptors: this.requestInterceptors.length,
            responseInterceptors: this.responseInterceptors.length,
            errorInterceptors: this.errorInterceptors.length,
            total: this.requestInterceptors.length + this.responseInterceptors.length + this.errorInterceptors.length
        };
    }

    /**
     * Clear all interceptors
     */
    clear(): void {
        this.requestInterceptors = [];
        this.responseInterceptors = [];
        this.errorInterceptors = [];
        this.log.info('All interceptors cleared');
    }

    private async runRequestInterceptors(context: RequestContext): Promise<RequestContext> {
        let currentContext = context;

        for (const interceptor of this.requestInterceptors) {
            // Check condition
            if (interceptor.condition && !interceptor.condition(currentContext)) {
                continue;
            }

            const startTime = Date.now();

            try {
                // Create next function
                const next = async () => currentContext;

                // Execute interceptor
                currentContext = await interceptor.intercept(currentContext, next);

                this.metrics.histogram('interceptor_request_duration', Date.now() - startTime);
            } catch (error) {
                this.log.error(`Request interceptor ${interceptor.name} failed`, {
                    error: (error as Error).message
                });
                this.metrics.counter('interceptor_request_errors', 1);
                throw error;
            }
        }

        return currentContext;
    }

    private async runResponseInterceptors(context: ResponseContext): Promise<ResponseContext> {
        let currentContext = context;

        // Execute in reverse order for responses (like Express middleware)
        const reversed = [...this.responseInterceptors].reverse();

        for (const interceptor of reversed) {
            // Check condition
            if (interceptor.condition && !interceptor.condition(currentContext)) {
                continue;
            }

            const startTime = Date.now();

            try {
                // Create next function
                const next = async () => currentContext;

                // Execute interceptor
                currentContext = await interceptor.intercept(currentContext, next);

                this.metrics.histogram('interceptor_response_duration', Date.now() - startTime);
            } catch (error) {
                this.log.error(`Response interceptor ${interceptor.name} failed`, {
                    error: (error as Error).message
                });
                this.metrics.counter('interceptor_response_errors', 1);
                throw error;
            }
        }

        return currentContext;
    }

    private async runErrorInterceptors(error: Error, context: RequestContext): Promise<void> {
        for (const interceptor of this.errorInterceptors) {
            // Check condition
            if (interceptor.condition && !interceptor.condition(context)) {
                continue;
            }

            try {
                // Create next function
                const next = async () => { };

                // Execute interceptor
                await interceptor.intercept(error, context, next);
            } catch (interceptorError) {
                this.log.error(`Error interceptor ${interceptor.name} failed`, {
                    error: (interceptorError as Error).message
                });
            }
        }
    }
}

// Common interceptors

export const requestLoggingInterceptor: RequestInterceptor = {
    name: 'requestLogging',
    priority: 100,
    intercept: async (context, next) => {
        const startTime = Date.now();
        const result = await next();
        const duration = Date.now() - startTime;

        console.log(`[${context.id}] ${context.method} ${context.url} - ${duration}ms`);

        return result;
    }
};

export const responseLoggingInterceptor: ResponseInterceptor = {
    name: 'responseLogging',
    priority: 100,
    intercept: async (context, next) => {
        const result = await next();
        console.log(`[${context.id}] Response ${result.status} - ${context.duration}ms`);
        return result;
    }
};

export const authInterceptor: RequestInterceptor = {
    name: 'auth',
    priority: 10,
    intercept: async (context, next) => {
        // Add auth header if available
        const apiKey = context.metadata.apiKey;
        if (apiKey) {
            context.headers['Authorization'] = `Bearer ${apiKey}`;
        }
        return next();
    }
};

export const retryInterceptor: RequestInterceptor = {
    name: 'retry',
    priority: 50,
    condition: (ctx) => ctx.metadata.retryable !== false,
    intercept: async (context, next) => {
        const maxRetries = context.metadata.maxRetries || 3;
        let attempt = 0;

        while (attempt <= maxRetries) {
            try {
                return await next();
            } catch (error) {
                attempt++;
                if (attempt > maxRetries) {
                    throw error;
                }
                // Exponential backoff
                await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 100));
            }
        }

        return next();
    }
};

export const metricsInterceptor: ResponseInterceptor = {
    name: 'metrics',
    priority: 90,
    intercept: async (context, next) => {
        const result = await next();

        // Record metrics
        const collector = MetricsCollector.getInstance();
        collector.histogram('request_duration', context.duration);
        collector.counter('requests_total', 1);

        return result;
    }
};

export const errorLoggingInterceptor: ErrorInterceptor = {
    name: 'errorLogging',
    priority: 10,
    intercept: async (error, context, next) => {
        console.error(`[${context.id}] Request failed: ${error.message}`);
        return next();
    }
};

// Preconfigured interceptor chain
export function createDefaultInterceptorChain(): InterceptorChain {
    const chain = new InterceptorChain();

    chain.addRequestInterceptor(authInterceptor);
    chain.addRequestInterceptor(requestLoggingInterceptor);
    chain.addRequestInterceptor(retryInterceptor);

    chain.addResponseInterceptor(metricsInterceptor);
    chain.addResponseInterceptor(responseLoggingInterceptor);

    chain.addErrorInterceptor(errorLoggingInterceptor);

    return chain;
}
