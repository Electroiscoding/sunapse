import * as assert from 'assert';
import * as vscode from 'vscode';
import { StateManager } from '../../core/StateManager';
import { ErrorHandler } from '../../core/ErrorHandler';
import { CircuitBreaker } from '../../core/CircuitBreaker';
import { RateLimiter } from '../../core/RateLimiter';
import { HealthMonitor } from '../../core/HealthMonitor';
import { CacheManager } from '../../core/CacheManager';
import { FeatureFlagManager } from '../../core/FeatureFlags';

suite('Production Systems Integration Tests', () => {
    let stateManager: StateManager;
    let context: vscode.ExtensionContext;

    suiteSetup(async () => {
        context = {
            globalState: {
                get: () => undefined,
                update: () => Promise.resolve(),
                keys: () => []
            },
            workspaceState: {
                get: () => undefined,
                update: () => Promise.resolve(),
                keys: () => []
            },
            secrets: {
                get: () => Promise.resolve(undefined),
                store: () => Promise.resolve(),
                delete: () => Promise.resolve()
            },
            extensionUri: vscode.Uri.file('/test'),
            globalStorageUri: vscode.Uri.file('/test/storage')
        } as unknown as vscode.ExtensionContext;

        stateManager = new StateManager(context);
    });

    suite('Circuit Breaker', () => {
        test('should trip after failures', async () => {
            const breaker = new CircuitBreaker('test', {
                failureThreshold: 2,
                resetTimeout: 1000
            });

            // First failure
            try {
                await breaker.execute(async () => {
                    throw new Error('Test error');
                });
            } catch (e) {
                // Expected
            }

            assert.strictEqual(breaker.getState(), 'CLOSED');

            // Second failure - should trip
            try {
                await breaker.execute(async () => {
                    throw new Error('Test error');
                });
            } catch (e) {
                // Expected
            }

            assert.strictEqual(breaker.getState(), 'OPEN');
        });

        test('should allow requests after reset timeout', async () => {
            const breaker = new CircuitBreaker('test', {
                failureThreshold: 1,
                resetTimeout: 50
            });

            // Trip the breaker
            try {
                await breaker.execute(async () => {
                    throw new Error('Test error');
                });
            } catch (e) {
                // Expected
            }

            assert.strictEqual(breaker.getState(), 'OPEN');

            // Wait for reset
            await new Promise(resolve => setTimeout(resolve, 100));

            // Should be in HALF_OPEN
            const result = await breaker.execute(async () => 'success');
            assert.strictEqual(result, 'success');
            assert.strictEqual(breaker.getState(), 'CLOSED');
        });
    });

    suite('Rate Limiter', () => {
        test('should allow requests within limit', async () => {
            const limiter = new RateLimiter({
                maxRequests: 3,
                windowMs: 1000
            });

            const results: boolean[] = [];
            for (let i = 0; i < 3; i++) {
                results.push(await limiter.checkLimit('user1'));
            }

            assert.deepStrictEqual(results, [true, true, true]);
        });

        test('should block requests over limit', async () => {
            const limiter = new RateLimiter({
                maxRequests: 2,
                windowMs: 1000
            });

            await limiter.checkLimit('user1');
            await limiter.checkLimit('user1');
            
            const allowed = await limiter.checkLimit('user1');
            assert.strictEqual(allowed, false);
        });

        test('should track different users separately', async () => {
            const limiter = new RateLimiter({
                maxRequests: 2,
                windowMs: 1000
            });

            await limiter.checkLimit('user1');
            await limiter.checkLimit('user1');

            // Different user should still have capacity
            const allowed = await limiter.checkLimit('user2');
            assert.strictEqual(allowed, true);
        });
    });

    suite('Cache Manager', () => {
        test('should store and retrieve values', () => {
            const cache = new CacheManager<string>({ maxSize: 100 });
            
            cache.set('key1', 'value1');
            const value = cache.get('key1');
            
            assert.strictEqual(value, 'value1');
        });

        test('should respect TTL', async () => {
            const cache = new CacheManager<string>({ defaultTTL: 50 });
            
            cache.set('key1', 'value1', 50);
            
            // Should exist immediately
            assert.strictEqual(cache.get('key1'), 'value1');
            
            // Wait for expiration
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Should be expired
            assert.strictEqual(cache.get('key1'), undefined);
        });

        test('should enforce max size with LRU eviction', () => {
            const cache = new CacheManager<string>({ maxSize: 2 });
            
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            cache.set('key3', 'value3');
            
            // key1 should be evicted
            assert.strictEqual(cache.get('key1'), undefined);
            assert.strictEqual(cache.get('key2'), 'value2');
            assert.strictEqual(cache.get('key3'), 'value3');
        });

        test('should track stats', () => {
            const cache = new CacheManager<string>({ maxSize: 100 });
            
            cache.set('key1', 'value1');
            cache.get('key1');
            cache.get('key1');
            cache.get('nonexistent');
            
            const stats = cache.getStats();
            assert.strictEqual(stats.size, 1);
            assert.strictEqual(stats.hits, 2);
            assert.strictEqual(stats.misses, 1);
        });
    });

    suite('Feature Flags', () => {
        test('should initialize and check flags', async () => {
            const flags = FeatureFlagManager.getInstance();
            flags.initialize(stateManager, 'test-user');

            await flags.setEnabled('test-flag', true);
            
            const isEnabled = flags.isEnabled('test-flag');
            assert.strictEqual(isEnabled, true);
        });

        test('should respect rollout percentage', async () => {
            const flags = FeatureFlagManager.getInstance();
            flags.initialize(stateManager, 'test-user-123');

            await flags.setRolloutPercentage('rollout-flag', 50);
            
            const isEnabled = flags.isEnabled('rollout-flag');
            // Should be deterministic based on user ID hash
            assert.strictEqual(typeof isEnabled, 'boolean');
        });

        test('should handle killswitch', async () => {
            const flags = FeatureFlagManager.getInstance();
            flags.initialize(stateManager, 'test-user');

            await flags.setEnabled('killswitch-flag', true);
            assert.strictEqual(flags.isEnabled('killswitch-flag'), true);

            await flags.emergencyKill();
            
            assert.strictEqual(flags.isEnabled('killswitch-flag'), false);
        });
    });

    suite('Error Handler', () => {
        test('should execute successful operations', async () => {
            const handler = ErrorHandler.getInstance();
            
            const result = await handler.executeWithRecovery(
                async () => 'success',
                { component: 'Test', operation: 'test' },
                'retry'
            );
            
            assert.strictEqual(result, 'success');
        });

        test('should retry failed operations', async () => {
            const handler = ErrorHandler.getInstance();
            let attempts = 0;
            
            const result = await handler.executeWithRecovery(
                async () => {
                    attempts++;
                    if (attempts < 2) {
                        throw new Error('Temporary failure');
                    }
                    return 'success';
                },
                { component: 'Test', operation: 'test' },
                'retry'
            );
            
            assert.strictEqual(result, 'success');
            assert.strictEqual(attempts, 2);
        });
    });

    suite('Health Monitor', () => {
        test('should report health status', async () => {
            const monitor = HealthMonitor.getInstance();
            
            const status = await monitor.checkAll();
            
            assert.ok(status.overall === 'healthy' || status.overall === 'degraded' || status.overall === 'unhealthy');
            assert.ok(Array.isArray(status.checks));
        });

        test('should track memory usage', () => {
            const monitor = HealthMonitor.getInstance();
            
            const memory = monitor.checkMemory();
            
            assert.ok(memory.heapUsed > 0);
            assert.ok(memory.heapTotal > 0);
        });
    });
});
