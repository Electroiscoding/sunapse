import { ErrorHandler } from './ErrorHandler';

/**
 * Rate limiting for API calls and resource usage
 * Prevents abuse and ensures fair usage
 */

export interface RateLimitConfig {
    maxRequests: number;      // Max requests in window
    windowMs: number;        // Time window in milliseconds
    burstAllowance?: number;  // Allow temporary burst
}

export interface RateLimitEntry {
    count: number;
    resetTime: number;
    burstCount: number;
}

export class RateLimiter {
    private limits: Map<string, RateLimitEntry> = new Map();
    private config: RateLimitConfig;

    constructor(config: Partial<RateLimitConfig> = {}) {
        this.config = {
            maxRequests: 60,      // 60 requests
            windowMs: 60 * 1000,  // per minute
            burstAllowance: 10,   // Allow 10 extra burst
            ...config
        };
    }

    /**
     * Check if operation is allowed
     */
    tryAcquire(key: string): { allowed: boolean; remaining: number; resetIn: number } {
        const now = Date.now();
        let entry = this.limits.get(key);

        // Create or reset entry if window expired
        if (!entry || now > entry.resetTime) {
            entry = {
                count: 0,
                resetTime: now + this.config.windowMs,
                burstCount: 0
            };
            this.limits.set(key, entry);
        }

        // Check if within limit
        const totalAllowed = this.config.maxRequests + (this.config.burstAllowance || 0);
        
        if (entry.count < this.config.maxRequests) {
            entry.count++;
            return {
                allowed: true,
                remaining: this.config.maxRequests - entry.count,
                resetIn: entry.resetTime - now
            };
        }

        // Check burst allowance
        if (entry.burstCount < (this.config.burstAllowance || 0)) {
            entry.burstCount++;
            return {
                allowed: true,
                remaining: 0,
                resetIn: entry.resetTime - now
            };
        }

        // Rate limit exceeded
        return {
            allowed: false,
            remaining: 0,
            resetIn: entry.resetTime - now
        };
    }

    /**
     * Acquire permit or throw error
     */
    acquire(key: string): void {
        const result = this.tryAcquire(key);
        if (!result.allowed) {
            throw new RateLimitError(
                `Rate limit exceeded for ${key}. Try again in ${Math.ceil(result.resetIn / 1000)}s`
            );
        }
    }

    /**
     * Execute with rate limiting
     */
    async execute<T>(key: string, operation: () => Promise<T>): Promise<T> {
        this.acquire(key);
        return await operation();
    }

    /**
     * Get current usage stats
     */
    getStats(key: string): {
        count: number;
        remaining: number;
        resetIn: number;
        burstUsed: number;
    } | null {
        const entry = this.limits.get(key);
        if (!entry) return null;

        const now = Date.now();
        if (now > entry.resetTime) return null;

        return {
            count: entry.count,
            remaining: Math.max(0, this.config.maxRequests - entry.count),
            resetIn: entry.resetTime - now,
            burstUsed: entry.burstCount
        };
    }

    /**
     * Reset rate limit for key
     */
    reset(key: string): void {
        this.limits.delete(key);
    }

    /**
     * Cleanup expired entries
     */
    cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.limits.entries()) {
            if (now > entry.resetTime) {
                this.limits.delete(key);
            }
        }
    }

    /**
     * Get all active limits
     */
    getActiveKeys(): string[] {
        this.cleanup();
        return Array.from(this.limits.keys());
    }
}

export class RateLimitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RateLimitError';
    }
}

// Rate limiters for different operations
export const apiRateLimiter = new RateLimiter({
    maxRequests: 50,
    windowMs: 60 * 1000,
    burstAllowance: 5
});

export const indexingRateLimiter = new RateLimiter({
    maxRequests: 10,
    windowMs: 60 * 1000,
    burstAllowance: 2
});

export const terminalRateLimiter = new RateLimiter({
    maxRequests: 20,
    windowMs: 60 * 1000,
    burstAllowance: 5
});

// User-specific rate limiters
export const userRateLimiters = new Map<string, RateLimiter>();

export function getUserRateLimiter(userId: string): RateLimiter {
    if (!userRateLimiters.has(userId)) {
        userRateLimiters.set(userId, new RateLimiter({
            maxRequests: 100,
            windowMs: 60 * 1000,
            burstAllowance: 20
        }));
    }
    return userRateLimiters.get(userId)!;
}
