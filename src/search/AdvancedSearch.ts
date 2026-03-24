import * as vscode from 'vscode';

/**
 * Advanced Search System
 * Regex, fuzzy matching, filters, and semantic search
 */

export interface SearchOptions {
    regex?: boolean;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    filePattern?: string;
    excludePattern?: string;
    maxResults?: number;
    includeSymbols?: boolean;
    fuzzy?: boolean;
}

export interface SearchResult {
    file: string;
    line: number;
    column: number;
    text: string;
    match: string;
    score?: number;
}

export class AdvancedSearch {
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Synapse Search');
    }

    /**
     * Search across workspace with advanced options
     */
    async searchWorkspace(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
        const startTime = Date.now();
        const results: SearchResult[] = [];

        try {
            // Build search pattern
            let searchPattern = query;
            
            if (options.regex) {
                // Validate regex
                try {
                    new RegExp(query);
                } catch {
                    throw new Error('Invalid regex pattern');
                }
            } else if (options.fuzzy) {
                searchPattern = this.fuzzyToRegex(query);
            } else {
                // Escape special chars for literal search
                searchPattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            }

            // Add word boundaries
            if (options.wholeWord) {
                searchPattern = `\\b${searchPattern}\\b`;
            }

            // Build VS Code search options
            const searchOptions: vscode.FindTextInFilesOptions = {
                useDefaultExcludes: true,
                useIgnoreFiles: true
            };

            if (options.caseSensitive) {
                searchOptions.caseSensitive = true;
            }

            // Execute search
            const pattern = new vscode.RelativePattern(
                vscode.workspace.workspaceFolders?.[0] || '',
                options.filePattern || '**/*'
            );

            const matches = await vscode.workspace.findTextInFiles(
                { pattern: searchPattern, isRegExp: true },
                searchOptions
            );

            // Process results
            for (const match of matches) {
                const lines = match.preview.text.split('\n');
                
                results.push({
                    file: match.uri.fsPath,
                    line: match.range.start.line,
                    column: match.range.start.character,
                    text: lines[0] || match.preview.text,
                    match: match.preview.text.substring(
                        match.preview.matches?.[0].start || 0,
                        match.preview.matches?.[0].end || match.preview.text.length
                    ),
                    score: options.fuzzy ? this.calculateFuzzyScore(query, match.preview.text) : 1
                });

                if (options.maxResults && results.length >= options.maxResults) {
                    break;
                }
            }

            // Sort by score if fuzzy
            if (options.fuzzy) {
                results.sort((a, b) => (b.score || 0) - (a.score || 0));
            }

            const duration = Date.now() - startTime;
            this.outputChannel.appendLine(
                `[Search] Found ${results.length} results in ${duration}ms`
            );

            return results;

        } catch (error) {
            this.outputChannel.appendLine(`[Search Error] ${error}`);
            throw error;
        }
    }

    /**
     * Convert fuzzy query to regex pattern
     */
    private fuzzyToRegex(query: string): string {
        // Split into characters and allow fuzziness between
        const chars = query.split('').map(c => {
            // Escape special regex chars
            if (/[.*+?^${}()|[\]\\]/.test(c)) {
                return '\\' + c;
            }
            return c;
        });

        // Build pattern: characters can have any characters between them
        return chars.join('.*?');
    }

    /**
     * Calculate fuzzy match score
     */
    private calculateFuzzyScore(query: string, text: string): number {
        const queryLower = query.toLowerCase();
        const textLower = text.toLowerCase();
        
        // Exact match gets highest score
        if (textLower.includes(queryLower)) {
            return 100;
        }

        // Check for fuzzy match
        let score = 0;
        let lastIndex = 0;
        
        for (const char of queryLower) {
            const index = textLower.indexOf(char, lastIndex);
            if (index !== -1) {
                score += 10;
                // Bonus for consecutive matches
                if (index === lastIndex) {
                    score += 5;
                }
                lastIndex = index + 1;
            }
        }

        // Penalty for length difference
        score -= Math.abs(query.length - text.length) * 2;

        return Math.max(0, score);
    }

    /**
     * Search symbols in workspace
     */
    async searchSymbols(query: string): Promise<vscode.SymbolInformation[]> {
        const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
            'vscode.executeWorkspaceSymbolProvider',
            query
        );

        return symbols || [];
    }

    /**
     * Filter results by criteria
     */
    filterResults(
        results: SearchResult[],
        filters: {
            fileTypes?: string[];
            excludePaths?: string[];
            minScore?: number;
        }
    ): SearchResult[] {
        return results.filter(result => {
            // Filter by file type
            if (filters.fileTypes) {
                const ext = result.file.split('.').pop()?.toLowerCase();
                if (!ext || !filters.fileTypes.includes(ext)) {
                    return false;
                }
            }

            // Filter by excluded paths
            if (filters.excludePaths) {
                for (const exclude of filters.excludePaths) {
                    if (result.file.includes(exclude)) {
                        return false;
                    }
                }
            }

            // Filter by score
            if (filters.minScore !== undefined && (result.score || 0) < filters.minScore) {
                return false;
            }

            return true;
        });
    }

    /**
     * Show search results in quick pick
     */
    async showResults(results: SearchResult[]): Promise<SearchResult | undefined> {
        const items = results.map((r, i) => ({
            label: `${i + 1}. ${path.basename(r.file)}:${r.line + 1}`,
            description: r.match.slice(0, 60),
            detail: r.file,
            result: r
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Found ${results.length} results`,
            canPickMany: false
        });

        if (selected) {
            // Open file at location
            const doc = await vscode.workspace.openTextDocument(selected.result.file);
            const editor = await vscode.window.showTextDocument(doc);
            
            const position = new vscode.Position(
                selected.result.line,
                selected.result.column
            );
            
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position));
            
            return selected.result;
        }

        return undefined;
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}

import * as path from 'path';

export const advancedSearch = new AdvancedSearch();
