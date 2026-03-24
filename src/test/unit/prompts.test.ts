import * as assert from 'assert';
import { describe, it } from 'mocha';
import { QUICK_PROMPTS, getPromptById, getPromptsByCategory, getDefaultQuickPrompts, SYSTEM_PROMPTS } from '../../prompts/templates';

describe('Prompt Templates', () => {
    describe('QUICK_PROMPTS', () => {
        it('should have valid prompt structures', () => {
            QUICK_PROMPTS.forEach(prompt => {
                assert.ok(prompt.id, 'Prompt should have id');
                assert.ok(prompt.name, 'Prompt should have name');
                assert.ok(prompt.icon, 'Prompt should have icon');
                assert.ok(prompt.category, 'Prompt should have category');
                assert.ok(prompt.prompt, 'Prompt should have prompt text');
            });
        });

        it('should have unique ids', () => {
            const ids = QUICK_PROMPTS.map(p => p.id);
            const uniqueIds = new Set(ids);
            assert.strictEqual(uniqueIds.size, ids.length, 'All prompt ids should be unique');
        });
    });

    describe('getPromptById', () => {
        it('should return prompt by id', () => {
            const prompt = getPromptById('explain-code');
            assert.ok(prompt);
            assert.strictEqual(prompt?.id, 'explain-code');
        });

        it('should return undefined for invalid id', () => {
            const prompt = getPromptById('non-existent');
            assert.strictEqual(prompt, undefined);
        });
    });

    describe('getPromptsByCategory', () => {
        it('should return prompts by category', () => {
            const codePrompts = getPromptsByCategory('code');
            assert.ok(codePrompts.length > 0);
            codePrompts.forEach(p => {
                assert.strictEqual(p.category, 'code');
            });
        });
    });

    describe('getDefaultQuickPrompts', () => {
        it('should return 4 default prompts', () => {
            const defaults = getDefaultQuickPrompts();
            assert.strictEqual(defaults.length, 4);
        });
    });

    describe('SYSTEM_PROMPTS', () => {
        it('should have all system prompts defined', () => {
            assert.ok(SYSTEM_PROMPTS.codeReview);
            assert.ok(SYSTEM_PROMPTS.architecture);
            assert.ok(SYSTEM_PROMPTS.debugging);
            assert.ok(SYSTEM_PROMPTS.refactoring);
            assert.ok(SYSTEM_PROMPTS.performance);
        });
    });
});
