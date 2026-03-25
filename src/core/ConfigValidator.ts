import * as vscode from 'vscode';

/**
 * Configuration validation and schema enforcement
 * Ensures all settings are valid and provides helpful error messages
 */

export interface ConfigSchema {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    required?: boolean;
    default?: any;
    enum?: any[];
    min?: number;
    max?: number;
    pattern?: string;
    validate?: (value: any) => { valid: boolean; message?: string };
}

export interface ConfigValidationResult {
    valid: boolean;
    errors: Array<{
        key: string;
        message: string;
        currentValue: any;
    }>;
    warnings: Array<{
        key: string;
        message: string;
        currentValue: any;
    }>;
}

export class ConfigValidator {
    private schemas: Map<string, ConfigSchema> = new Map();

    constructor() {
        this.registerDefaultSchemas();
    }

    private registerDefaultSchemas(): void {
        // Provider settings
        this.registerSchema('synapse.provider', {
            type: 'string',
            required: true,
            enum: ['openrouter', 'huggingface', 'openai', 'anthropic', 'custom'],
            default: 'openrouter'
        });

        this.registerSchema('synapse.model', {
            type: 'string',
            required: true,
            pattern: '^[a-zA-Z0-9_/.\\-]+$',
            default: 'anthropic/claude-3.5-sonnet'
        });

        this.registerSchema('synapse.apiKey', {
            type: 'string',
            required: false,
            pattern: '^[a-zA-Z0-9\\_-]{10,}$',
            validate: (value) => {
                if (!value || value.length < 10) {
                    return { valid: false, message: 'API key appears too short (min 10 chars)' };
                }
                if (value.includes(' ')) {
                    return { valid: false, message: 'API key should not contain spaces' };
                }
                return { valid: true };
            }
        });

        this.registerSchema('synapse.maxTokens', {
            type: 'number',
            required: true,
            min: 1,
            max: 128000,
            default: 4096
        });

        this.registerSchema('synapse.temperature', {
            type: 'number',
            required: true,
            min: 0,
            max: 2,
            default: 0.7
        });

        // Indexing settings
        this.registerSchema('synapse.indexing.enabled', {
            type: 'boolean',
            required: true,
            default: true
        });

        this.registerSchema('synapse.indexing.excludePatterns', {
            type: 'array',
            required: true,
            default: [
                '**/node_modules/**',
                '**/.git/**',
                '**/dist/**',
                '**/build/**'
            ]
        });

        // Cleft settings
        this.registerSchema('synapse.cleft.enabled', {
            type: 'boolean',
            required: true,
            default: false
        });

        this.registerSchema('synapse.cleft.autoConfirm', {
            type: 'boolean',
            required: true,
            default: false
        });

        // Agent settings
        this.registerSchema('synapse.agents.activeAgents', {
            type: 'array',
            required: true,
            default: ['coder', 'orchestrator'],
            validate: (value) => {
                if (!Array.isArray(value) || value.length === 0) {
                    return { valid: false, message: 'At least one agent must be active' };
                }
                const validAgents = ['coder', 'orchestrator', 'critic', 'architect', 'debugger', 'docs'];
                const invalid = value.filter(a => !validAgents.includes(a));
                if (invalid.length > 0) {
                    return { valid: false, message: `Invalid agents: ${invalid.join(', ')}` };
                }
                return { valid: true };
            }
        });

        // Iteration settings
        this.registerSchema('synapse.iteration.autoIterate', {
            type: 'boolean',
            required: true,
            default: false
        });

        this.registerSchema('synapse.iteration.checkpointInterval', {
            type: 'number',
            required: true,
            min: 60,
            max: 3600,
            default: 300
        });

        // Telemetry settings
        this.registerSchema('synapse.telemetry.enabled', {
            type: 'boolean',
            required: true,
            default: true
        });

        this.registerSchema('synapse.telemetry.debug', {
            type: 'boolean',
            required: true,
            default: false
        });
    }

    registerSchema(key: string, schema: ConfigSchema): void {
        this.schemas.set(key, schema);
    }

    /**
     * Validate a single configuration value
     */
    validateValue(key: string, value: any): { valid: boolean; message?: string } {
        const schema = this.schemas.get(key);

        if (!schema) {
            return { valid: true }; // Unknown keys pass through
        }

        // Check required
        if (schema.required && (value === undefined || value === null || value === '')) {
            return { valid: false, message: `Configuration '${key}' is required` };
        }

        // Skip further validation if not required and empty
        if (!schema.required && (value === undefined || value === null || value === '')) {
            return { valid: true };
        }

        // Type validation
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== schema.type) {
            return {
                valid: false,
                message: `Expected type '${schema.type}' but got '${actualType}'`
            };
        }

        // Enum validation
        if (schema.enum && !schema.enum.includes(value)) {
            return {
                valid: false,
                message: `Value must be one of: ${schema.enum.join(', ')}`
            };
        }

        // Pattern validation for strings
        if (schema.pattern && typeof value === 'string') {
            const regex = new RegExp(schema.pattern);
            if (!regex.test(value)) {
                return {
                    valid: false,
                    message: `Value does not match required pattern: ${schema.pattern}`
                };
            }
        }

        // Range validation for numbers
        if (typeof value === 'number') {
            if (schema.min !== undefined && value < schema.min) {
                return { valid: false, message: `Minimum value is ${schema.min}` };
            }
            if (schema.max !== undefined && value > schema.max) {
                return { valid: false, message: `Maximum value is ${schema.max}` };
            }
        }

        // Custom validation
        if (schema.validate) {
            return schema.validate(value);
        }

        return { valid: true };
    }

    /**
     * Validate all Synapse configurations
     */
    validateAll(): ConfigValidationResult {
        const config = vscode.workspace.getConfiguration('synapse');
        const errors: ConfigValidationResult['errors'] = [];
        const warnings: ConfigValidationResult['warnings'] = [];

        for (const [key, schema] of this.schemas) {
            const value = config.get(key.replace('synapse.', ''));
            const result = this.validateValue(key, value);

            if (!result.valid) {
                errors.push({
                    key,
                    message: result.message || 'Invalid value',
                    currentValue: value
                });
            }

            // Additional warnings
            if (key === 'synapse.cleft.autoConfirm' && value === true) {
                warnings.push({
                    key,
                    message: 'Auto-confirming terminal commands is potentially dangerous',
                    currentValue: value
                });
            }

            if (key === 'synapse.temperature' && typeof value === 'number' && value > 1.0) {
                warnings.push({
                    key,
                    message: 'Temperature above 1.0 may produce unpredictable results',
                    currentValue: value
                });
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Get default value for a configuration
     */
    getDefault(key: string): any {
        const schema = this.schemas.get(key);
        return schema?.default;
    }

    /**
     * Reset configuration to defaults
     */
    async resetToDefaults(): Promise<void> {
        const config = vscode.workspace.getConfiguration('synapse');

        for (const [key, schema] of this.schemas) {
            if (schema.default !== undefined) {
                const configKey = key.replace('synapse.', '');
                await config.update(configKey, schema.default, true);
            }
        }
    }

    /**
     * Show validation results to user
     */
    async showValidationResults(): Promise<void> {
        const result = this.validateAll();

        if (result.valid && result.warnings.length === 0) {
            vscode.window.showInformationMessage('✓ Synapse configuration is valid');
            return;
        }

        const items = [
            ...result.errors.map(e => `❌ ${e.key}: ${e.message}`),
            ...result.warnings.map(w => `⚠️ ${w.key}: ${w.message}`)
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Configuration issues found (click to see details)',
            canPickMany: false
        });

        if (selected) {
            vscode.commands.executeCommand('workbench.action.openSettings', 'synapse');
        }
    }

    /**
     * Fix common configuration issues automatically
     */
    async autoFix(): Promise<{ fixed: string[]; failed: string[] }> {
        const config = vscode.workspace.getConfiguration('synapse');
        const fixed: string[] = [];
        const failed: string[] = [];

        const result = this.validateAll();

        for (const error of result.errors) {
            const schema = this.schemas.get(error.key);
            if (schema?.default !== undefined) {
                try {
                    const configKey = error.key.replace('synapse.', '');
                    await config.update(configKey, schema.default, true);
                    fixed.push(error.key);
                } catch {
                    failed.push(error.key);
                }
            } else {
                failed.push(error.key);
            }
        }

        return { fixed, failed };
    }
}

// Singleton instance
let validator: ConfigValidator | null = null;

export function getConfigValidator(): ConfigValidator {
    if (!validator) {
        validator = new ConfigValidator();
    }
    return validator;
}
