import { getComponentLogger } from '../logging/Logger';
import { MetricsCollector } from '../metrics/MetricsCollector';

/**
 * ConnectionPool - Production-grade connection pooling for API clients
 * 
 * Features:
 * - Connection reuse and recycling
 * - Max connections limit
 * - Connection timeout handling
 * - Health checking
 * - Graceful shutdown
 * - Connection multiplexing
 */

export interface PoolConfig {
    maxConnections?: number;
    minConnections?: number;
    acquireTimeout?: number;
    idleTimeout?: number;
    healthCheckInterval?: number;
    maxRequestsPerConnection?: number;
}

export interface PooledConnection<T> {
    id: string;
    connection: T;
    createdAt: number;
    lastUsed: number;
    requestCount: number;
    healthy: boolean;
    inUse: boolean;
}

export type ConnectionFactory<T> = () => Promise<T>;
export type ConnectionValidator<T> = (conn: T) => Promise<boolean>;
export type ConnectionCloser<T> = (conn: T) => Promise<void>;

export class ConnectionPool<T> {
    private config: Required<PoolConfig>;
    private pool: PooledConnection<T>[] = [];
    private waitQueue: Array<{
        resolve: (conn: PooledConnection<T>) => void;
        reject: (error: Error) => void;
        timeout: ReturnType<typeof setTimeout>;
    }> = [];
    private factory: ConnectionFactory<T>;
    private validator: ConnectionValidator<T>;
    private closer: ConnectionCloser<T>;
    private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private log = getComponentLogger('ConnectionPool');
    private metrics = MetricsCollector.getInstance();
    private closed = false;

    constructor(
        name: string,
        factory: ConnectionFactory<T>,
        validator: ConnectionValidator<T>,
        closer: ConnectionCloser<T>,
        config: PoolConfig = {}
    ) {
        this.factory = factory;
        this.validator = validator;
        this.closer = closer;
        this.config = {
            maxConnections: config.maxConnections || 10,
            minConnections: config.minConnections || 2,
            acquireTimeout: config.acquireTimeout || 5000,
            idleTimeout: config.idleTimeout || 300000,
            healthCheckInterval: config.healthCheckInterval || 30000,
            maxRequestsPerConnection: config.maxRequestsPerConnection || 1000
        };

        this.initialize();
    }

    /**
     * Acquire a connection from the pool
     */
    async acquire(): Promise<PooledConnection<T>> {
        if (this.closed) {
            throw new Error('Pool is closed');
        }

        return this.metrics.time('pool_acquire', async () => {
            // Try to get existing available connection
            const available = this.findAvailableConnection();
            if (available) {
                available.inUse = true;
                available.lastUsed = Date.now();
                this.metrics.counter('pool_hits', 1);
                return available;
            }

            // Create new connection if under limit
            if (this.pool.length < this.config.maxConnections) {
                const conn = await this.createConnection();
                conn.inUse = true;
                this.pool.push(conn);
                this.metrics.gauge('pool_connections', this.pool.length);
                return conn;
            }

            // Wait for connection to become available
            return this.waitForConnection();
        });
    }

    /**
     * Release a connection back to the pool
     */
    release(connection: PooledConnection<T>): void {
        connection.inUse = false;
        connection.lastUsed = Date.now();

        // Check if connection should be retired
        if (connection.requestCount >= this.config.maxRequestsPerConnection) {
            this.retireConnection(connection);
            return;
        }

        // Serve waiting request
        if (this.waitQueue.length > 0) {
            const waiter = this.waitQueue.shift();
            if (waiter) {
                clearTimeout(waiter.timeout);
                connection.inUse = true;
                waiter.resolve(connection);
            }
        }

        this.metrics.counter('pool_releases', 1);
    }

    /**
     * Execute with automatic acquire/release
     */
    async execute<R>(fn: (conn: T) => Promise<R>): Promise<R> {
        const pooled = await this.acquire();
        try {
            pooled.requestCount++;
            return await fn(pooled.connection);
        } finally {
            this.release(pooled);
        }
    }

    /**
     * Get pool statistics
     */
    getStats(): {
        total: number;
        available: number;
        inUse: number;
        unhealthy: number;
        waiting: number;
    } {
        return {
            total: this.pool.length,
            available: this.pool.filter(c => !c.inUse && c.healthy).length,
            inUse: this.pool.filter(c => c.inUse).length,
            unhealthy: this.pool.filter(c => !c.healthy).length,
            waiting: this.waitQueue.length
        };
    }

    /**
     * Close the pool and all connections
     */
    async close(): Promise<void> {
        this.closed = true;

        // Stop health checks
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }

        // Reject all waiting requests
        for (const waiter of this.waitQueue) {
            clearTimeout(waiter.timeout);
            waiter.reject(new Error('Pool closed'));
        }
        this.waitQueue = [];

        // Close all connections
        await Promise.all(
            this.pool.map(async conn => {
                try {
                    await this.closer(conn.connection);
                } catch (error) {
                    this.log.error('Error closing connection', { error: (error as Error).message });
                }
            })
        );

        this.pool = [];
        this.metrics.gauge('pool_connections', 0);
        this.log.info('Pool closed');
    }

    /**
     * Drain the pool (close after all connections released)
     */
    async drain(): Promise<void> {
        // Wait for all connections to be released
        while (this.pool.some(c => c.inUse)) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        await this.close();
    }

    private async initialize(): Promise<void> {
        // Create minimum connections
        for (let i = 0; i < this.config.minConnections; i++) {
            try {
                const conn = await this.createConnection();
                this.pool.push(conn);
            } catch (error) {
                this.log.error('Failed to create initial connection', { error: (error as Error).message });
            }
        }

        // Start health checks
        this.healthCheckTimer = setInterval(() => {
            this.runHealthChecks();
        }, this.config.healthCheckInterval);

        // Start idle cleanup
        setInterval(() => {
            this.cleanupIdleConnections();
        }, this.config.idleTimeout);

        this.log.info('Pool initialized', {
            connections: this.pool.length,
            min: this.config.minConnections,
            max: this.config.maxConnections
        });
    }

    private async createConnection(): Promise<PooledConnection<T>> {
        const connection = await this.factory();

        return {
            id: `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            connection,
            createdAt: Date.now(),
            lastUsed: Date.now(),
            requestCount: 0,
            healthy: true,
            inUse: false
        };
    }

    private findAvailableConnection(): PooledConnection<T> | undefined {
        for (const conn of this.pool) {
            if (!conn.inUse && conn.healthy) {
                return conn;
            }
        }
        return undefined;
    }

    private waitForConnection(): Promise<PooledConnection<T>> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                const index = this.waitQueue.findIndex(w => w.resolve === resolve);
                if (index !== -1) {
                    this.waitQueue.splice(index, 1);
                }
                reject(new Error('Connection acquire timeout'));
            }, this.config.acquireTimeout);

            this.waitQueue.push({ resolve, reject, timeout });
        });
    }

    private async retireConnection(conn: PooledConnection<T>): Promise<void> {
        const index = this.pool.indexOf(conn);
        if (index !== -1) {
            this.pool.splice(index, 1);
        }

        try {
            await this.closer(conn.connection);
        } catch (error) {
            this.log.error('Error retiring connection', { error: (error as Error).message });
        }

        // Create replacement if needed
        if (this.pool.length < this.config.minConnections) {
            try {
                const newConn = await this.createConnection();
                this.pool.push(newConn);
            } catch (error) {
                this.log.error('Failed to create replacement connection', { error: (error as Error).message });
            }
        }

        this.metrics.gauge('pool_connections', this.pool.length);
        this.metrics.counter('pool_connections_retired', 1);
    }

    private async runHealthChecks(): Promise<void> {
        for (const conn of this.pool) {
            if (conn.inUse) continue;

            try {
                const healthy = await this.validator(conn.connection);
                conn.healthy = healthy;

                if (!healthy) {
                    this.log.warn('Unhealthy connection detected, retiring');
                    this.retireConnection(conn);
                }
            } catch (error) {
                this.log.error('Health check failed', { error: (error as Error).message });
                conn.healthy = false;
                this.retireConnection(conn);
            }
        }
    }

    private async cleanupIdleConnections(): Promise<void> {
        const now = Date.now();
        const toRemove: PooledConnection<T>[] = [];

        for (const conn of this.pool) {
            if (!conn.inUse && now - conn.lastUsed > this.config.idleTimeout) {
                // Don't go below minimum
                if (this.pool.length - toRemove.length > this.config.minConnections) {
                    toRemove.push(conn);
                }
            }
        }

        for (const conn of toRemove) {
            await this.retireConnection(conn);
        }

        if (toRemove.length > 0) {
            this.log.info(`Cleaned up ${toRemove.length} idle connections`);
        }
    }
}

/**
 * Simple HTTP connection pool for API requests
 */
export interface HttpConnection {
    baseUrl: string;
    headers: Record<string, string>;
    lastResponse?: number;
}

export function createHttpConnectionPool(
    baseUrl: string,
    defaultHeaders: Record<string, string> = {},
    config?: PoolConfig
): ConnectionPool<HttpConnection> {
    return new ConnectionPool<HttpConnection>(
        'http-pool',
        async () => ({
            baseUrl,
            headers: { ...defaultHeaders },
            lastResponse: Date.now()
        }),
        async (conn) => {
            // Health check: verify connection is recent
            return Date.now() - (conn.lastResponse || 0) < 300000;
        },
        async () => {
            // No cleanup needed for HTTP
        },
        config
    );
}
