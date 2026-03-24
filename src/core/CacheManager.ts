import * as vscode from 'vscode';

/**
 * Production-grade caching system with TTL and LRU eviction
 */

export interface CacheEntry<T> {
    value: T;
    timestamp: number;
    ttl: number;
    accessCount: number;
}

export interface CacheConfig {
    maxSize: number;
    defaultTtl: number;
    checkInterval: number;
}

export class CacheManager<T> {
    private cache: Map<string, CacheEntry<T>> = new Map();
    private config: CacheConfig;
    private cleanupInterval: ReturnType<typeof setInterval> | null = null;
    private hits: number = 0;
    private misses: number = 0;

    constructor(config: Partial<CacheConfig> = {}) {
        this.config = {
            maxSize: config.maxSize || 1000,
            defaultTtl: config.defaultTtl || 5 * 60 * 1000, // 5 minutes
            checkInterval: config.checkInterval || 60 * 1000 // 1 minute
        };

        // Start cleanup interval
        this.cleanupInterval = setInterval(() => this.cleanup(), this.config.checkInterval);
    }

    /**
     * Get value from cache
     */
    get(key: string): T | undefined {
        const entry = this.cache.get(key);

        if (!entry) {
            this.misses++;
            return undefined;
        }

        // Check if expired
        if (Date.now() - entry.timestamp > entry.ttl) {
            this.cache.delete(key);
            this.misses++;
            return undefined;
        }

        // Update access count
        entry.accessCount++;
        this.hits++;

        return entry.value;
    }

    /**
     * Set value in cache
     */
    set(key: string, value: T, ttl?: number): void {
        // Evict if at capacity (LRU)
        if (this.cache.size >= this.config.maxSize) {
            this.evictLRU();
        }

        this.cache.set(key, {
            value,
            timestamp: Date.now(),
            ttl: ttl || this.config.defaultTtl,
            accessCount: 1
        });
    }

    /**
     * Check if key exists and is not expired
     */
    has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) return false;

        if (Date.now() - entry.timestamp > entry.ttl) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    /**
     * Delete key from cache
     */
    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    /**
     * Clear all entries
     */
    clear(): void {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }

    /**
     * Get or compute value
     */
    async getOrCompute(
        key: string,
        compute: () => Promise<T>,
        ttl?: number
    ): Promise<T> {
        const cached = this.get(key);
        if (cached !== undefined) {
            return cached;
        }

        const value = await compute();
        this.set(key, value, ttl);
        return value;
    }

    /**
     * Evict least recently used entries
     */
    private evictLRU(): void {
        let lruKey: string | null = null;
        let lruCount = Infinity;
        let lruTime = Infinity;

        for (const [key, entry] of this.cache.entries()) {
            // Prioritize by access count, then by timestamp
            if (entry.accessCount < lruCount ||
                (entry.accessCount === lruCount && entry.timestamp < lruTime)) {
                lruKey = key;
                lruCount = entry.accessCount;
                lruTime = entry.timestamp;
            }
        }

        if (lruKey) {
            this.cache.delete(lruKey);
        }
    }

    /**
     * Clean up expired entries
     */
    private cleanup(): void {
        const now = Date.now();
        const expired: string[] = [];

        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > entry.ttl) {
                expired.push(key);
            }
        }

        expired.forEach(key => this.cache.delete(key));
    }

    /**
     * Get cache statistics
     */
    getStats(): {
        size: number;
        maxSize: number;
        hits: number;
        misses: number;
        hitRate: number;
    } {
        const total = this.hits + this.misses;
        return {
            size: this.cache.size,
            maxSize: this.config.maxSize,
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? (this.hits / total) * 100 : 0
        };
    }

    /**
     * Get all keys
     */
    keys(): string[] {
        return Array.from(this.cache.keys());
    }

    /**
     * Dispose cache manager
     */
    dispose(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.clear();
    }
}

/**
 * Specialized caches for Synapse
 */

// API response cache
export const apiCache = new CacheManager<any>({
    maxSize: 500,
    defaultTtl: 60 * 1000 // 1 minute
});

// File content cache
export const fileCache = new CacheManager<string>({
    maxSize: 200,
    defaultTtl: 30 * 1000 // 30 seconds
});

// Index search results cache
export const searchCache = new CacheManager<any[]>({
    maxSize: 100,
    defaultTtl: 5 * 60 * 1000 // 5 minutes
});

// Agent response cache (for similar queries)
export const agentCache = new CacheManager<string>({
    maxSize: 50,
    defaultTtl: 10 * 60 * 1000 // 10 minutes
});

/**
 * Memoization decorator for methods
 */
export function Memoize(ttl: number = 60000) {
    return function (
        target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ) {
        const originalMethod = descriptor.value;
        const cache = new CacheManager<any>({ maxSize: 100, defaultTtl: ttl });

        descriptor.value = async function (...args: any[]) {
            const key = JSON.stringify(args);
            return cache.getOrCompute(key, () => originalMethod.apply(this, args));
        };

        return descriptor;
    };
}

/**
 * Persistent cache using VS Code storage
 */
export class PersistentCache<T> {
    private globalState: vscode.Memento;
    private cacheKey: string;
    private memoryCache: CacheManager<T>;

    constructor(context: vscode.ExtensionContext, cacheKey: string, config?: Partial<CacheConfig>) {
        this.globalState = context.globalState;
        this.cacheKey = cacheKey;
        this.memoryCache = new CacheManager<T>(config);

        // Load from persistent storage
        this.loadFromStorage();
    }

    private async loadFromStorage(): Promise<void> {
        const stored = this.globalState.get<Record<string, CacheEntry<T>>>(this.cacheKey, {});

        for (const [key, entry] of Object.entries(stored)) {
            const typedEntry = entry as CacheEntry<T>;
            if (Date.now() - typedEntry.timestamp <= typedEntry.ttl) {
                this.memoryCache.set(key, typedEntry.value, typedEntry.ttl - (Date.now() - typedEntry.timestamp));
            }
        }
    }

    async saveToStorage(): Promise<void> {
        const entries: Record<string, CacheEntry<T>> = {};

        for (const key of this.memoryCache.keys()) {
            const value = this.memoryCache.get(key);
            if (value !== undefined) {
                entries[key] = {
                    value,
                    timestamp: Date.now(),
                    ttl: 24 * 60 * 60 * 1000, // 24 hours
                    accessCount: 1
                };
            }
        }

        await this.globalState.update(this.cacheKey, entries);
    }

    get(key: string): T | undefined {
        return this.memoryCache.get(key);
    }

    set(key: string, value: T, ttl?: number): void {
        this.memoryCache.set(key, value, ttl);
    }

    async dispose(): Promise<void> {
        await this.saveToStorage();
        this.memoryCache.dispose();
    }
}
