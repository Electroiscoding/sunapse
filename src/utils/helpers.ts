/**
 * Utility functions for Synapse AI extension
 */

export class Debouncer {
    private timeout: ReturnType<typeof setTimeout> | null = null;

    constructor(private delay: number = 300) {}

    debounce<T extends (...args: any[]) => any>(fn: T): (...args: Parameters<T>) => void {
        return (...args: Parameters<T>) => {
            if (this.timeout) {
                clearTimeout(this.timeout);
            }
            this.timeout = setTimeout(() => fn(...args), this.delay);
        };
    }

    cancel(): void {
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
    }
}

export class Throttler {
    private lastRun: number = 0;
    private timeout: ReturnType<typeof setTimeout> | null = null;

    constructor(private delay: number = 300) {}

    throttle<T extends (...args: any[]) => any>(fn: T): (...args: Parameters<T>) => void {
        return (...args: Parameters<T>) => {
            const now = Date.now();
            const remaining = this.delay - (now - this.lastRun);

            if (remaining <= 0) {
                this.lastRun = now;
                fn(...args);
            } else {
                if (this.timeout) {
                    clearTimeout(this.timeout);
                }
                this.timeout = setTimeout(() => {
                    this.lastRun = Date.now();
                    fn(...args);
                }, remaining);
            }
        };
    }
}

export function truncateText(text: string, maxLength: number, suffix: string = '...'): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - suffix.length) + suffix;
}

export function sanitizeFileName(fileName: string): string {
    return fileName.replace(/[<>:"/\\|?*]/g, '_');
}

export function estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token on average
    return Math.ceil(text.length / 4);
}

export function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

export function generateId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;
}

export function safeJsonParse<T>(text: string, defaultValue: T): T {
    try {
        return JSON.parse(text) as T;
    } catch {
        return defaultValue;
    }
}

export function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function dedent(strings: TemplateStringsArray, ...values: any[]): string {
    const text = strings.reduce((acc, str, i) => acc + str + (values[i] || ''), '');
    const lines = text.split('\n');
    
    // Find minimum indentation
    const minIndent = lines
        .filter(line => line.trim())
        .reduce((min, line) => {
            const indent = line.match(/^\s*/)?.[0].length || 0;
            return Math.min(min, indent);
        }, Infinity);

    return lines
        .map(line => line.slice(minIndent))
        .join('\n')
        .trim();
}

export async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function retry<T>(
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    delay: number = 1000
): Promise<T> {
    return new Promise(async (resolve, reject) => {
        let lastError: Error;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const result = await fn();
                resolve(result);
                return;
            } catch (error) {
                lastError = error as Error;
                if (attempt < maxAttempts) {
                    await sleep(delay * attempt);
                }
            }
        }

        reject(lastError!);
    });
}

export function chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

export function deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
}

export function isValidUrl(string: string): boolean {
    try {
        new URL(string);
        return true;
    } catch {
        return false;
    }
}

export function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function countLines(text: string): number {
    return text.split('\n').length;
}

export function getLineAt(text: string, lineNumber: number): string {
    const lines = text.split('\n');
    return lines[lineNumber] || '';
}

export function insertAtLine(text: string, lineNumber: number, content: string): string {
    const lines = text.split('\n');
    lines.splice(lineNumber, 0, content);
    return lines.join('\n');
}

export function removeLines(text: string, startLine: number, endLine: number): string {
    const lines = text.split('\n');
    lines.splice(startLine, endLine - startLine + 1);
    return lines.join('\n');
}

export function getSurroundingContext(
    text: string,
    targetLine: number,
    contextLines: number = 5
): string {
    const lines = text.split('\n');
    const start = Math.max(0, targetLine - contextLines);
    const end = Math.min(lines.length, targetLine + contextLines + 1);
    return lines.slice(start, end).join('\n');
}
