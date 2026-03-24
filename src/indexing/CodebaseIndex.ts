import * as vscode from 'vscode';
import * as path from 'path';
import { minimatch } from 'minimatch';
import { StateManager } from '../core/StateManager';

interface IndexedFile {
    path: string;
    content: string;
    language: string;
    lastModified: number;
    embeddings?: number[];
    tokens?: number;
}

interface SearchResult {
    path: string;
    score: number;
    preview: string;
}

export class CodebaseIndex {
    private context: vscode.ExtensionContext;
    private stateManager: StateManager;
    private files: Map<string, IndexedFile> = new Map();
    private isIndexing: boolean = false;
    private indexVersion: number = 1;

    constructor(context: vscode.ExtensionContext, stateManager: StateManager) {
        this.context = context;
        this.stateManager = stateManager;
        this.loadIndex();
    }

    private async loadIndex(): Promise<void> {
        const saved = this.stateManager.getWorkspaceState<{
            files: IndexedFile[];
            version: number;
            timestamp: number;
        }>('codebaseIndex');
        
        if (saved && saved.files) {
            for (const file of saved.files) {
                this.files.set(file.path, file);
            }
            this.indexVersion = saved.version || 1;
            console.log(`Loaded index with ${this.files.size} files`);
        }
    }

    async indexWorkspace(): Promise<void> {
        if (this.isIndexing) {
            vscode.window.showWarningMessage('Indexing already in progress...');
            return;
        }

        this.isIndexing = true;
        const config = vscode.workspace.getConfiguration('synapse');
        const excludePatterns = config.get<string[]>('indexing.excludePatterns', [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/build/**',
            '**/*.min.js',
            '**/*.min.css'
        ]);

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                vscode.window.showWarningMessage('No workspace folder open');
                return;
            }

            let indexedCount = 0;
            const maxFiles = 10000;
            const filesToIndex: string[] = [];

            // Collect files
            for (const folder of workspaceFolders) {
                const pattern = new vscode.RelativePattern(folder, '**/*');
                const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**', maxFiles);
                
                for (const uri of uris) {
                    const relativePath = vscode.workspace.asRelativePath(uri);
                    
                    // Check exclude patterns
                    const isExcluded = excludePatterns.some((pattern: string) => 
                        minimatch(relativePath, pattern, { dot: true })
                    );
                    
                    if (!isExcluded) {
                        filesToIndex.push(uri.fsPath);
                    }
                }
            }

            // Index files in batches
            const batchSize = 50;
            for (let i = 0; i < filesToIndex.length; i += batchSize) {
                const batch = filesToIndex.slice(i, i + batchSize);
                await Promise.all(batch.map(filePath => this.indexFile(filePath)));
                
                indexedCount += batch.length;
                
                // Update progress every batch
                if (i % (batchSize * 10) === 0) {
                    vscode.window.setStatusBarMessage(
                        `Synapse: Indexing... ${indexedCount}/${filesToIndex.length} files`,
                        2000
                    );
                }
            }

            // Save index
            await this.saveIndex();
            
            vscode.window.showInformationMessage(
                `Synapse: Indexed ${indexedCount} files successfully!`
            );
            
        } catch (error) {
            vscode.window.showErrorMessage(`Indexing failed: ${error}`);
        } finally {
            this.isIndexing = false;
            vscode.window.setStatusBarMessage('');
        }
    }

    private async indexFile(filePath: string): Promise<void> {
        try {
            const uri = vscode.Uri.file(filePath);
            const stat = await vscode.workspace.fs.stat(uri);
            
            // Skip files larger than 1MB
            if (stat.size > 1024 * 1024) {
                return;
            }

            // Check if file needs reindexing
            const existing = this.files.get(filePath);
            if (existing && existing.lastModified >= stat.mtime) {
                return;
            }

            const document = await vscode.workspace.openTextDocument(uri);
            const content = document.getText();
            
            // Skip binary files
            if (this.isBinaryContent(content)) {
                return;
            }

            const language = document.languageId;
            const fileName = path.basename(filePath);
            
            const indexedFile: IndexedFile = {
                path: filePath,
                content,
                language,
                lastModified: stat.mtime,
                tokens: this.estimateTokens(content)
            };

            this.files.set(filePath, indexedFile);
            
        } catch (error) {
            // Skip files that can't be read
            console.warn(`Failed to index ${filePath}: ${error}`);
        }
    }

    private isBinaryContent(content: string): boolean {
        // Check for null bytes or high ratio of non-printable chars
        const sample = content.slice(0, 1000);
        const nullBytes = (sample.match(/\x00/g) || []).length;
        return nullBytes > 0 || (nullBytes / sample.length) > 0.1;
    }

    private estimateTokens(content: string): number {
        // Rough estimate: ~4 chars per token on average
        return Math.ceil(content.length / 4);
    }

    private async saveIndex(): Promise<void> {
        const data = {
            files: Array.from(this.files.values()),
            version: this.indexVersion,
            timestamp: Date.now()
        };
        
        await this.stateManager.setWorkspaceState('codebaseIndex', data);
    }

    async search(query: string, limit: number = 10): Promise<SearchResult[]> {
        const results: SearchResult[] = [];
        const queryLower = query.toLowerCase();
        const queryTerms = queryLower.split(/\s+/);
        
        for (const [filePath, file] of this.files) {
            let score = 0;
            const contentLower = file.content.toLowerCase();
            
            // Filename matching
            const fileName = path.basename(filePath).toLowerCase();
            if (fileName.includes(queryLower)) {
                score += 10;
            }
            
            // Path matching
            if (filePath.toLowerCase().includes(queryLower)) {
                score += 5;
            }
            
            // Content matching with term frequency
            for (const term of queryTerms) {
                if (term.length < 3) continue;
                
                const regex = new RegExp(term, 'gi');
                const matches = (contentLower.match(regex) || []).length;
                score += matches * 2;
            }
            
            // Language relevance boost
            const queryLang = this.detectLanguageInQuery(queryLower);
            if (queryLang && file.language === queryLang) {
                score += 3;
            }
            
            if (score > 0) {
                // Extract preview
                const preview = this.extractPreview(file.content, queryTerms);
                
                results.push({
                    path: filePath,
                    score,
                    preview
                });
            }
        }
        
        // Sort by score and return top results
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, limit);
    }

    private detectLanguageInQuery(query: string): string | null {
        const langKeywords: Record<string, string[]> = {
            typescript: ['typescript', 'ts', 'angular', 'react ts'],
            javascript: ['javascript', 'js', 'node', 'nodejs', 'react'],
            python: ['python', 'py', 'django', 'flask', 'pandas'],
            java: ['java', 'spring', 'maven', 'gradle'],
            go: ['golang', 'go'],
            rust: ['rust', 'cargo'],
            cpp: ['c++', 'cpp', 'cplusplus'],
            csharp: ['c#', 'csharp', '.net', 'dotnet'],
            ruby: ['ruby', 'rails'],
            php: ['php', 'laravel', 'symfony'],
        };
        
        for (const [lang, keywords] of Object.entries(langKeywords)) {
            if (keywords.some(kw => query.includes(kw))) {
                return lang;
            }
        }
        return null;
    }

    private extractPreview(content: string, queryTerms: string[]): string {
        const contentLower = content.toLowerCase();
        
        // Find first occurrence of any query term
        let bestIndex = -1;
        for (const term of queryTerms) {
            if (term.length < 3) continue;
            const index = contentLower.indexOf(term);
            if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
                bestIndex = index;
            }
        }
        
        if (bestIndex === -1) {
            // Return first 200 chars if no match
            return content.slice(0, 200).replace(/\n/g, ' ') + '...';
        }
        
        // Extract context around match
        const start = Math.max(0, bestIndex - 100);
        const end = Math.min(content.length, bestIndex + 200);
        let preview = content.slice(start, end);
        
        if (start > 0) preview = '...' + preview;
        if (end < content.length) preview = preview + '...';
        
        return preview.replace(/\n/g, ' ');
    }

    getFile(path: string): IndexedFile | undefined {
        return this.files.get(path);
    }

    async getContextForPrompt(query: string, maxTokens: number = 4000): Promise<string> {
        const results = await this.search(query, 20);
        let context = '';
        let tokensUsed = 0;
        
        for (const result of results) {
            const file = this.files.get(result.path);
            if (!file) continue;
            
            const fileHeader = `\n// File: ${result.path}\n`;
            const content = file.content;
            
            const fileTokens = this.estimateTokens(fileHeader + content);
            
            if (tokensUsed + fileTokens > maxTokens) {
                // Add truncated version if we have room
                const remaining = maxTokens - tokensUsed;
                if (remaining > 500) {
                    const truncated = content.slice(0, remaining * 4);
                    context += fileHeader + truncated + '\n// ... truncated\n';
                }
                break;
            }
            
            context += fileHeader + content + '\n';
            tokensUsed += fileTokens;
        }
        
        return context;
    }

    async clearIndex(): Promise<void> {
        this.files.clear();
        this.indexVersion++;
        await this.saveIndex();
    }

    getStats(): { totalFiles: number; totalTokens: number; languages: Record<string, number> } {
        let totalTokens = 0;
        const languages: Record<string, number> = {};
        
        for (const file of this.files.values()) {
            totalTokens += file.tokens || 0;
            languages[file.language] = (languages[file.language] || 0) + 1;
        }
        
        return {
            totalFiles: this.files.size,
            totalTokens,
            languages
        };
    }

    dispose(): void {
        this.saveIndex();
    }
}
