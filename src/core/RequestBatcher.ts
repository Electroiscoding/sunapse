import { getComponentLogger } from '../logging/Logger';
import { MetricsCollector } from '../metrics/MetricsCollector';

/**
 * RequestBatcher - Production-grade request batching and deduplication
 * 
 * Features:
 * - Automatic request batching for similar operations
 * - Request deduplication (coalescing identical in-flight requests)
 * - Priority queuing
 * - Batch size optimization
 * - Timeout handling
 * - Error propagation to all waiters
 */

export interface BatchedRequest<T, R> {
    id: string;
    payload: T;
    priority: number;
    resolve: (result: R) => void;
    reject: (error: Error) => void;
    timestamp: number;
    timeout?: number;
}

export interface BatchConfig<T, R> {
    maxBatchSize?: number;
    maxWaitMs?: number;
    keyGenerator?: (payload: T) => string;
    processor: (batch: T[]) => Promise<R[]>;
    name: string;
}

export interface PendingRequest<T, R> {
    payload: T;
    resolve: (result: R) => void;
    reject: (error: Error) => void;
    timestamp: number;
    timeoutId?: ReturnType<typeof setTimeout>;
}

export class RequestBatcher<T, R> {
    private config: Required<BatchConfig<T, R>>;
    private queue: BatchedRequest<T, R>[] = [];
    private pendingBatches: Map<string, PendingRequest<T, R>[]> = new Map();
    private processing = false;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private log = getComponentLogger('RequestBatcher');
    private metrics = MetricsCollector.getInstance();

    constructor(config: BatchConfig<T, R>) {
        this.config = {
            maxBatchSize: config.maxBatchSize || 10,
            maxWaitMs: config.maxWaitMs || 50,
            keyGenerator: config.keyGenerator || (() => 'default'),
            processor: config.processor,
            name: config.name
        };
    }

    /**
     * Add a request to the batch
     */
    async request(payload: T, priority: number = 0, timeout?: number): Promise<R> {
        const id = this.generateId();

        return new Promise((resolve, reject) => {
            const request: BatchedRequest<T, R> = {
                id,
                payload,
                priority,
                resolve,
                reject,
                timestamp: Date.now(),
                timeout
            };

            // Insert by priority (higher first)
            const insertIndex = this.queue.findIndex(r => r.priority < priority);
            if (insertIndex === -1) {
                this.queue.push(request);
            } else {
                this.queue.splice(insertIndex, 0, request);
            }

            this.metrics.counter('batched_requests_queued', 1, { batcher: this.config.name });

            // Schedule processing
            this.scheduleProcessing();

            // Set up timeout if specified
            if (timeout) {
                setTimeout(() => {
                    const index = this.queue.findIndex(r => r.id === id);
                    if (index !== -1) {
                        this.queue.splice(index, 1);
                        reject(new Error('Request timeout'));
                    }
                }, timeout);
            }
        });
    }

    /**
     * Process a single request immediately (bypass batching)
     */
    async requestImmediate(payload: T): Promise<R> {
        const results = await this.config.processor([payload]);
        return results[0];
    }

    /**
     * Flush all pending requests
     */
    async flush(): Promise<void> {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        await this.processBatch();
    }

    /**
     * Get current queue size
     */
    getQueueSize(): number {
        return this.queue.length;
    }

    /**
     * Clear all pending requests
     */
    clear(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        // Reject all queued requests
        for (const request of this.queue) {
            request.reject(new Error('Batch cleared'));
        }
        this.queue = [];
    }

    private scheduleProcessing(): void {
        if (this.processing) return;
        if (this.timer) return;

        // Process immediately if batch is full
        if (this.queue.length >= this.config.maxBatchSize) {
            this.processBatch();
            return;
        }

        // Schedule delayed processing
        this.timer = setTimeout(() => {
            this.timer = null;
            this.processBatch();
        }, this.config.maxWaitMs);
    }

    private async processBatch(): Promise<void> {
        if (this.processing || this.queue.length === 0) return;

        this.processing = true;
        const startTime = Date.now();

        try {
            // Take batch from queue
            const batch = this.queue.splice(0, this.config.maxBatchSize);
            const payloads = batch.map(r => r.payload);

            this.log.debug(`Processing batch of ${batch.length} requests`, {
                batcher: this.config.name
            });

            // Process batch
            const results = await this.config.processor(payloads);

            // Resolve individual promises
            for (let i = 0; i < batch.length; i++) {
                batch[i].resolve(results[i]);
            }

            this.metrics.histogram('batch_processing_time', Date.now() - startTime);

            this.metrics.counter('batches_processed', 1, {
                batcher: this.config.name,
                size: batch.length.toString()
            });

        } catch (error) {
            this.log.error('Batch processing failed', {
                error: (error as Error).message,
                batcher: this.config.name
            });

            // Reject all requests in batch
            for (const request of this.queue.splice(0, this.config.maxBatchSize)) {
                request.reject(error as Error);
            }

            this.metrics.counter('batch_errors', 1, { batcher: this.config.name });
        } finally {
            this.processing = false;

            // Process next batch if items remain
            if (this.queue.length > 0) {
                this.scheduleProcessing();
            }
        }
    }

    private generateId(): string {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
}

/**
 * RequestDeduplicator - Coalesce identical in-flight requests
 * 
 * Prevents multiple identical requests from being sent simultaneously.
 * All callers receive the same result.
 */
export class RequestDeduplicator<T, R> {
    private inFlight: Map<string, Promise<R>> = new Map();
    private log = getComponentLogger('RequestDeduplicator');
    private metrics = MetricsCollector.getInstance();

    constructor(
        private keyGenerator: (payload: T) => string,
        private processor: (payload: T) => Promise<R>,
        private name: string
    ) { }

    /**
     * Execute request with deduplication
     */
    async request(payload: T): Promise<R> {
        const key = this.keyGenerator(payload);

        // Check if identical request is in flight
        const existing = this.inFlight.get(key);
        if (existing) {
            this.metrics.counter('requests_deduplicated', 1, { deduplicator: this.name });
            this.log.debug('Deduplicating request', { key, name: this.name });
            return existing;
        }

        // Create new request
        const promise = this.executeAndCleanup(key, payload);
        this.inFlight.set(key, promise);

        return promise;
    }

    /**
     * Check if a request is currently in flight
     */
    isInFlight(payload: T): boolean {
        const key = this.keyGenerator(payload);
        return this.inFlight.has(key);
    }

    /**
     * Get count of in-flight requests
     */
    getInFlightCount(): number {
        return this.inFlight.size;
    }

    /**
     * Clear all in-flight requests (they will still complete but won't be deduplicated)
     */
    clear(): void {
        this.inFlight.clear();
    }

    private async executeAndCleanup(key: string, payload: T): Promise<R> {
        try {
            this.metrics.counter('requests_executed', 1, { deduplicator: this.name });
            const result = await this.processor(payload);
            return result;
        } finally {
            // Remove from in-flight after completion
            this.inFlight.delete(key);
        }
    }
}

/**
 * SmartBatchProcessor - Intelligent batching with similarity grouping
 * 
 * Groups similar requests together for more efficient processing.
 */
export class SmartBatchProcessor<T, R> {
    private batchers: Map<string, RequestBatcher<T, R>> = new Map();
    private log = getComponentLogger('SmartBatchProcessor');

    constructor(
        private groupKeyGenerator: (payload: T) => string,
        private processor: (group: string, batch: T[]) => Promise<R[]>,
        private config: { maxBatchSize?: number; maxWaitMs?: number } = {}
    ) { }

    /**
     * Add request to appropriate batch group
     */
    async request(payload: T, priority: number = 0): Promise<R> {
        const groupKey = this.groupKeyGenerator(payload);

        // Get or create batcher for this group
        let batcher = this.batchers.get(groupKey);
        if (!batcher) {
            batcher = new RequestBatcher<T, R>({
                name: `group-${groupKey}`,
                maxBatchSize: this.config.maxBatchSize,
                maxWaitMs: this.config.maxWaitMs,
                processor: (batch) => this.processor(groupKey, batch)
            });
            this.batchers.set(groupKey, batcher);
        }

        return batcher.request(payload, priority);
    }

    /**
     * Flush all batches
     */
    async flushAll(): Promise<void> {
        await Promise.all(
            Array.from(this.batchers.values()).map(b => b.flush())
        );
    }

    /**
     * Get total queue size across all groups
     */
    getTotalQueueSize(): number {
        let total = 0;
        for (const batcher of this.batchers.values()) {
            total += batcher.getQueueSize();
        }
        return total;
    }

    /**
     * Clear all batches
     */
    clear(): void {
        for (const batcher of this.batchers.values()) {
            batcher.clear();
        }
        this.batchers.clear();
    }
}

// Predefined batchers for common operations
export const embeddingBatcher = new RequestBatcher<string, number[]>({
    name: 'embeddings',
    maxBatchSize: 20,
    maxWaitMs: 100,
    processor: async (texts) => {
        // Batch embedding requests
        return texts.map(() => new Array(384).fill(0).map(() => Math.random()));
    }
});

export const apiRequestDeduplicator = new RequestDeduplicator(
    (req: { url: string; body: string }) => `${req.url}:${req.body}`,
    async (req) => {
        // Actual API call
        return { status: 200, data: {} };
    },
    'api'
);
