import { ErrorHandler, ErrorContext } from './ErrorHandler';

/**
 * Circuit Breaker pattern for resilient API calls
 * Prevents cascading failures when services are down
 */

export enum CircuitState {
    CLOSED = 'CLOSED',      // Normal operation
    OPEN = 'OPEN',         // Failing, reject calls
    HALF_OPEN = 'HALF_OPEN' // Testing if service recovered
}

export interface CircuitBreakerConfig {
    failureThreshold: number;      // Failures before opening
    successThreshold: number;      // Successes before closing
    timeout: number;              // Time before attempting reset
    resetTimeout: number;         // Time before half-open
}

export class CircuitBreaker {
    private state: CircuitState = CircuitState.CLOSED;
    private failureCount: number = 0;
    private successCount: number = 0;
    private lastFailureTime: number = 0;
    private nextAttempt: number = 0;
    private errorHandler = ErrorHandler.getInstance();

    constructor(
        private name: string,
        private config: Partial<CircuitBreakerConfig> = {}
    ) {
        this.config = {
            failureThreshold: 5,
            successThreshold: 1,  // Single success closes circuit from HALF_OPEN
            timeout: 60000,
            resetTimeout: 30000,
            ...config
        };
    }

    /**
     * Execute function with circuit breaker protection
     */
    async execute<T>(
        operation: () => Promise<T>,
        context?: Partial<ErrorContext>
    ): Promise<T> {
        // Check if circuit is open
        if (this.state === CircuitState.OPEN) {
            if (Date.now() < this.nextAttempt) {
                throw new CircuitBreakerError(
                    `Circuit breaker '${this.name}' is OPEN. Retry after ${new Date(this.nextAttempt).toISOString()}`
                );
            }
            // Transition to half-open
            this.state = CircuitState.HALF_OPEN;
            this.successCount = 0;
        }

        try {
            const result = await this.errorHandler.executeWithRecovery(
                operation,
                {
                    operation: 'circuit_breaker_execute',
                    component: this.name,
                    ...context
                },
                'api'
            );

            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    private onSuccess(): void {
        if (this.state === CircuitState.HALF_OPEN) {
            this.successCount++;
            if (this.successCount >= (this.config.successThreshold || 3)) {
                this.reset();
            }
        } else {
            this.failureCount = 0;
        }
    }

    private onFailure(): void {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.failureCount >= (this.config.failureThreshold || 5)) {
            this.trip();
        }
    }

    private trip(): void {
        this.state = CircuitState.OPEN;
        this.nextAttempt = Date.now() + (this.config.resetTimeout || 30000);
        console.error(`[CircuitBreaker] '${this.name}' tripped OPEN. Next attempt: ${new Date(this.nextAttempt).toISOString()}`);
    }

    private reset(): void {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        console.log(`[CircuitBreaker] '${this.name}' reset to CLOSED`);
    }

    getState(): CircuitState {
        if (this.state === CircuitState.OPEN && Date.now() >= this.nextAttempt) {
            // Auto-reset to CLOSED after timeout (simpler model)
            this.reset();
        }
        return this.state;
    }

    getStats(): {
        state: CircuitState;
        failures: number;
        successes: number;
        lastFailure: number;
    } {
        return {
            state: this.getState(),
            failures: this.failureCount,
            successes: this.successCount,
            lastFailure: this.lastFailureTime
        };
    }
}

export class CircuitBreakerError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CircuitBreakerError';
    }
}

// Circuit breakers for different services
export const providerCircuitBreaker = new CircuitBreaker('ai-provider', {
    failureThreshold: 3,
    successThreshold: 2,
    resetTimeout: 60000
});

export const indexingCircuitBreaker = new CircuitBreaker('codebase-indexing', {
    failureThreshold: 5,
    successThreshold: 3,
    resetTimeout: 30000
});

export const terminalCircuitBreaker = new CircuitBreaker('terminal-commands', {
    failureThreshold: 3,
    successThreshold: 1,
    resetTimeout: 10000
});
