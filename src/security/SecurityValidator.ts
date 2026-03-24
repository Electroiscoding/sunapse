import * as vscode from 'vscode';

/**
 * Security validation and sanitization
 * Ensures safe operations and prevents injection attacks
 */

export class SecurityValidator {
    private static dangerousCommands = [
        'rm -rf /',
        'rm -rf ~',
        'rm -rf *',
        'format',
        'mkfs',
        'dd if=/dev/zero',
        '> /dev/sda',
        ':(){ :|:& };:',
        'del /f /s /q',
        'rmdir /s /q',
        'powershell -enc',
        'iex',
        'Invoke-Expression',
        'wget.*|.*sh',
        'curl.*|.*sh',
        'base64 -d',
        'eval',
        'exec',
        'system',
        'fork',
        'kill -9',
        'chmod 777',
        'sudo rm',
        'sudo dd'
    ];

    private static allowedSchemes = [
        'http', 'https', 'file', 'vscode'
    ];

    /**
     * Validate terminal command for dangerous operations
     */
    static validateCommand(command: string): { safe: boolean; reason?: string } {
        const lowerCmd = command.toLowerCase().trim();

        // Check for dangerous patterns
        for (const pattern of this.dangerousCommands) {
            if (lowerCmd.includes(pattern.toLowerCase())) {
                return {
                    safe: false,
                    reason: `Command contains dangerous pattern: ${pattern}`
                };
            }
        }

        // Check for shell injection
        if (/[;&|`$]/.test(command)) {
            return {
                safe: false,
                reason: 'Command contains shell metacharacters that could enable injection'
            };
        }

        // Check for path traversal
        if (/\.\.\//.test(command) || /\.\.\\/.test(command)) {
            return {
                safe: false,
                reason: 'Command contains path traversal sequences'
            };
        }

        return { safe: true };
    }

    /**
     * Sanitize user input for safe display
     */
    static sanitizeInput(input: string): string {
        // Remove control characters
        return input
            .replace(/[\x00-\x1F\x7F]/g, '')
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .slice(0, 10000); // Limit length
    }

    /**
     * Validate file path
     */
    static validatePath(filePath: string): { valid: boolean; reason?: string } {
        // Check for null bytes
        if (filePath.includes('\x00')) {
            return { valid: false, reason: 'Path contains null bytes' };
        }

        // Check length
        if (filePath.length > 4096) {
            return { valid: false, reason: 'Path exceeds maximum length' };
        }

        // Check for traversal
        const normalized = filePath.replace(/\\/g, '/');
        const parts = normalized.split('/');
        let depth = 0;

        for (const part of parts) {
            if (part === '..') {
                depth--;
                if (depth < 0) {
                    return { valid: false, reason: 'Path escapes root directory' };
                }
            } else if (part !== '.' && part !== '') {
                depth++;
            }
        }

        return { valid: true };
    }

    /**
     * Validate URL
     */
    static validateUrl(url: string): { valid: boolean; reason?: string } {
        try {
            const parsed = new URL(url);
            
            if (!this.allowedSchemes.includes(parsed.protocol.slice(0, -1))) {
                return { 
                    valid: false, 
                    reason: `URL scheme not allowed: ${parsed.protocol}` 
                };
            }

            // Block localhost in production
            const hostname = parsed.hostname.toLowerCase();
            if (hostname === 'localhost' || hostname === '127.0.0.1') {
                // Could allow in dev, block in prod
                // For now, warn
                console.warn('[Security] Localhost URL detected:', url);
            }

            return { valid: true };
        } catch {
            return { valid: false, reason: 'Invalid URL format' };
        }
    }

    /**
     * Validate API key format (without exposing actual key)
     */
    static validateApiKeyFormat(key: string, provider: string): { valid: boolean; reason?: string } {
        if (!key || key.length < 10) {
            return { valid: false, reason: 'API key appears too short' };
        }

        // Check for common prefixes based on provider
        const providerPatterns: Record<string, RegExp> = {
            'openai': /^sk-/,
            'anthropic': /^sk-ant-/,
            'huggingface': /^hf_/,
            'openrouter': /./ // Any format accepted
        };

        const pattern = providerPatterns[provider.toLowerCase()];
        if (pattern && !pattern.test(key)) {
            return { 
                valid: false, 
                reason: `API key format doesn't match ${provider} expected pattern` 
            };
        }

        return { valid: true };
    }

    /**
     * Escape special regex characters
     */
    static escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Check if content contains sensitive data
     */
    static containsSensitiveData(content: string): { found: boolean; type?: string } {
        const patterns = [
            { name: 'API Key', pattern: /(sk-[a-zA-Z0-9]{20,})/ },
            { name: 'Password', pattern: /password\s*[=:]\s*[^\s]+/i },
            { name: 'Secret', pattern: /secret\s*[=:]\s*[^\s]+/i },
            { name: 'Token', pattern: /token\s*[=:]\s*[^\s]+/i },
            { name: 'Private Key', pattern: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/ },
            { name: 'AWS Key', pattern: /AKIA[0-9A-Z]{16}/ },
            { name: 'GitHub Token', pattern: /ghp_[a-zA-Z0-9]{36}/ }
        ];

        for (const { name, pattern } of patterns) {
            if (pattern.test(content)) {
                return { found: true, type: name };
            }
        }

        return { found: false };
    }

    /**
     * Sanitize file content for safe indexing
     */
    static sanitizeFileContent(content: string): string {
        // Remove potential script tags
        content = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        
        // Remove sensitive patterns
        content = content.replace(/(sk-[a-zA-Z0-9]{20,})/g, '[REDACTED_API_KEY]');
        content = content.replace(/password\s*[=:]\s*[^\s\n]+/gi, 'password: [REDACTED]');
        
        // Limit size for safety
        if (content.length > 10 * 1024 * 1024) { // 10MB
            content = content.slice(0, 10 * 1024 * 1024) + '\n[Content truncated for safety]';
        }

        return content;
    }

    /**
     * Validate agent configuration
     */
    static validateAgentConfig(config: { name: string; systemPrompt: string }): { valid: boolean; reason?: string } {
        if (!config.name || config.name.length < 1 || config.name.length > 50) {
            return { valid: false, reason: 'Agent name must be 1-50 characters' };
        }

        if (!config.systemPrompt || config.systemPrompt.length < 10) {
            return { valid: false, reason: 'System prompt must be at least 10 characters' };
        }

        if (config.systemPrompt.length > 10000) {
            return { valid: false, reason: 'System prompt exceeds maximum length (10000 chars)' };
        }

        // Check for prompt injection attempts
        const injectionPatterns = [
            /ignore previous instructions/i,
            /disregard (the|your) system prompt/i,
            /you are now .* instead/i,
            /system:.*override/i
        ];

        for (const pattern of injectionPatterns) {
            if (pattern.test(config.systemPrompt)) {
                return { valid: false, reason: 'Potential prompt injection detected' };
            }
        }

        return { valid: true };
    }
}

/**
 * Command allowlist for Cleft terminal operations
 */
export class CommandAllowlist {
    private static allowedCommands = new Set([
        'npm', 'yarn', 'pnpm',
        'git', 'gh',
        'docker', 'docker-compose',
        'python', 'python3', 'pip',
        'node', 'npx',
        'tsc', 'eslint', 'prettier',
        'jest', 'vitest', 'mocha',
        'mkdir', 'ls', 'cd', 'pwd',
        'cat', 'echo', 'grep', 'find',
        'curl', 'wget',
        'code', 'code-insiders'
    ]);

    private static blockedCommands = new Set([
        'sudo', 'su', 'passwd',
        'rm', 'del', 'rmdir',
        'format', 'fdisk', 'mkfs',
        'dd', 'shred',
        'chmod', 'chown',
        'nc', 'netcat', 'telnet',
        'ssh', 'scp', 'sftp',
        'wget.*|.*sh', 'curl.*|.*bash'
    ]);

    static isAllowed(command: string): { allowed: boolean; reason?: string } {
        const parts = command.trim().split(/\s+/);
        const baseCommand = parts[0].toLowerCase();

        // Check blocked first
        if (this.blockedCommands.has(baseCommand)) {
            return { 
                allowed: false, 
                reason: `Command '${baseCommand}' is in the blocked list for safety` 
            };
        }

        // Check if allowed
        if (this.allowedCommands.has(baseCommand)) {
            // Additional validation for command arguments
            const args = parts.slice(1);
            
            // Check for dangerous flags
            const dangerousFlags = ['--force', '-f', '--yes', '-y', '--no-preserve-root'];
            for (const flag of args) {
                if (dangerousFlags.includes(flag)) {
                    return {
                        allowed: false,
                        reason: `Dangerous flag '${flag}' detected`
                    };
                }
            }

            return { allowed: true };
        }

        // Unknown command - require manual approval
        return { 
            allowed: false, 
            reason: `Command '${baseCommand}' is not in the allowlist. Manual approval required.` 
        };
    }

    static addAllowedCommand(command: string): void {
        this.allowedCommands.add(command.toLowerCase());
    }

    static removeAllowedCommand(command: string): void {
        this.allowedCommands.delete(command.toLowerCase());
    }
}

/**
 * Audit logger for security events
 */
export class SecurityAudit {
    private static events: Array<{
        timestamp: number;
        type: string;
        details: string;
        severity: 'info' | 'warning' | 'critical';
    }> = [];

    static log(type: string, details: string, severity: 'info' | 'warning' | 'critical' = 'info'): void {
        this.events.push({
            timestamp: Date.now(),
            type,
            details,
            severity
        });

        // Keep only last 1000 events
        if (this.events.length > 1000) {
            this.events = this.events.slice(-1000);
        }

        // Log critical events immediately
        if (severity === 'critical') {
            console.error(`[SECURITY CRITICAL] ${type}: ${details}`);
        }
    }

    static getEvents(filter?: { type?: string; since?: number }): typeof SecurityAudit.events {
        let filtered = this.events;

        if (filter?.type) {
            filtered = filtered.filter(e => e.type === filter.type);
        }

        if (filter?.since) {
            filtered = filtered.filter(e => e.timestamp >= filter.since!);
        }

        return filtered;
    }

    static clear(): void {
        this.events = [];
    }
}
