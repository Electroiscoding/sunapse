import * as assert from 'assert';
import { describe, it, beforeEach } from 'mocha';
import { estimateTokens, truncateText, generateId, Debouncer, Throttler, chunkArray, deepClone, formatDuration, sleep } from '../../utils/helpers';

describe('Helper Utilities', () => {
    describe('estimateTokens', () => {
        it('should estimate tokens correctly', () => {
            assert.strictEqual(estimateTokens(''), 0);
            assert.strictEqual(estimateTokens('hello'), 2);
            assert.strictEqual(estimateTokens('a'.repeat(100)), 25);
        });
    });

    describe('truncateText', () => {
        it('should not truncate short text', () => {
            assert.strictEqual(truncateText('hello', 10), 'hello');
        });

        it('should truncate long text', () => {
            assert.strictEqual(truncateText('hello world', 8), 'hello...');
        });

        it('should use custom suffix', () => {
            assert.strictEqual(truncateText('hello world', 8, ' [more]'), 'hello  [more]');
        });
    });

    describe('generateId', () => {
        it('should generate unique ids', () => {
            const id1 = generateId();
            const id2 = generateId();
            assert.notStrictEqual(id1, id2);
            assert.ok(id1.length > 0);
        });
    });

    describe('chunkArray', () => {
        it('should chunk array correctly', () => {
            const arr = [1, 2, 3, 4, 5];
            const chunks = chunkArray(arr, 2);
            assert.deepStrictEqual(chunks, [[1, 2], [3, 4], [5]]);
        });

        it('should handle empty array', () => {
            const chunks = chunkArray([], 2);
            assert.deepStrictEqual(chunks, []);
        });
    });

    describe('deepClone', () => {
        it('should clone objects', () => {
            const obj = { a: 1, b: { c: 2 } };
            const cloned = deepClone(obj);
            assert.deepStrictEqual(cloned, obj);
            assert.notStrictEqual(cloned, obj);
            assert.notStrictEqual(cloned.b, obj.b);
        });
    });

    describe('formatDuration', () => {
        it('should format seconds', () => {
            assert.strictEqual(formatDuration(5000), '5s');
        });

        it('should format minutes', () => {
            assert.strictEqual(formatDuration(90000), '1m 30s');
        });

        it('should format hours', () => {
            assert.strictEqual(formatDuration(3660000), '1h 1m');
        });
    });

    describe('sleep', () => {
        it('should sleep for specified time', async () => {
            const start = Date.now();
            await sleep(50);
            const elapsed = Date.now() - start;
            assert.ok(elapsed >= 50);
        });
    });
});
