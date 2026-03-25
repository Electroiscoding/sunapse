import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CleftEngine } from '../cleft/CleftEngine';
import { CodebaseIndex } from '../indexing/CodebaseIndex';

export interface Tool {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, any>;
        required: string[];
    };
    execute: (params: any) => Promise<ToolResult>;
}

export interface ToolResult {
    success: boolean;
    output: string;
    error?: string;
}

export class ToolRegistry {
    private tools: Map<string, Tool> = new Map();
    private cleftEngine: CleftEngine;
    private codebaseIndex: CodebaseIndex;

    constructor(cleftEngine: CleftEngine, codebaseIndex: CodebaseIndex) {
        this.cleftEngine = cleftEngine;
        this.codebaseIndex = codebaseIndex;
        this.registerDefaultTools();
    }

    private registerDefaultTools(): void {
        // File reading tool
        this.register({
            name: 'read_file',
            description: 'Read the contents of a file. Use this to understand code, configs, or documentation.',
            parameters: {
                type: 'object',
                properties: {
                    file_path: {
                        type: 'string',
                        description: 'Absolute path to the file to read'
                    },
                    offset: {
                        type: 'number',
                        description: 'Line number to start reading from (1-indexed, optional)',
                        default: 1
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum lines to read (optional)',
                        default: 100
                    }
                },
                required: ['file_path']
            },
            execute: async (params) => {
                try {
                    const content = await fs.readFile(params.file_path, 'utf-8');
                    const lines = content.split('\n');
                    const offset = (params.offset || 1) - 1;
                    const limit = params.limit || 100;
                    const selectedLines = lines.slice(offset, offset + limit);

                    return {
                        success: true,
                        output: selectedLines.join('\n'),
                        error: undefined
                    };
                } catch (error) {
                    return {
                        success: false,
                        output: '',
                        error: `Failed to read file: ${(error as Error).message}`
                    };
                }
            }
        });

        // File writing tool
        this.register({
            name: 'write_file',
            description: 'Write content to a file. Creates the file if it doesn\'t exist, overwrites if it does.',
            parameters: {
                type: 'object',
                properties: {
                    file_path: {
                        type: 'string',
                        description: 'Absolute path to the file to write'
                    },
                    content: {
                        type: 'string',
                        description: 'Content to write to the file'
                    }
                },
                required: ['file_path', 'content']
            },
            execute: async (params) => {
                try {
                    const dir = path.dirname(params.file_path);
                    await fs.mkdir(dir, { recursive: true });
                    await fs.writeFile(params.file_path, params.content, 'utf-8');

                    return {
                        success: true,
                        output: `Successfully wrote ${params.content.length} characters to ${params.file_path}`,
                        error: undefined
                    };
                } catch (error) {
                    return {
                        success: false,
                        output: '',
                        error: `Failed to write file: ${(error as Error).message}`
                    };
                }
            }
        });

        // File edit tool
        this.register({
            name: 'edit_file',
            description: 'Apply an edit to a file using search and replace. The search must match exactly.',
            parameters: {
                type: 'object',
                properties: {
                    file_path: {
                        type: 'string',
                        description: 'Absolute path to the file to edit'
                    },
                    old_string: {
                        type: 'string',
                        description: 'The exact string to find and replace'
                    },
                    new_string: {
                        type: 'string',
                        description: 'The replacement string'
                    }
                },
                required: ['file_path', 'old_string', 'new_string']
            },
            execute: async (params) => {
                try {
                    const content = await fs.readFile(params.file_path, 'utf-8');

                    if (!content.includes(params.old_string)) {
                        return {
                            success: false,
                            output: '',
                            error: `Could not find the search string in file. The content must match exactly.`
                        };
                    }

                    const newContent = content.replace(params.old_string, params.new_string);
                    await fs.writeFile(params.file_path, newContent, 'utf-8');

                    return {
                        success: true,
                        output: `Successfully replaced ${params.old_string.length} characters with ${params.new_string.length} characters`,
                        error: undefined
                    };
                } catch (error) {
                    return {
                        success: false,
                        output: '',
                        error: `Failed to edit file: ${(error as Error).message}`
                    };
                }
            }
        });

        // List directory tool
        this.register({
            name: 'list_dir',
            description: 'List files and directories in a given path. Use this to explore the project structure.',
            parameters: {
                type: 'object',
                properties: {
                    dir_path: {
                        type: 'string',
                        description: 'Absolute path to the directory to list'
                    }
                },
                required: ['dir_path']
            },
            execute: async (params) => {
                try {
                    const entries = await fs.readdir(params.dir_path, { withFileTypes: true });
                    const files = entries
                        .filter(e => e.isFile())
                        .map(e => `📄 ${e.name}`);
                    const dirs = entries
                        .filter(e => e.isDirectory())
                        .map(e => `📁 ${e.name}/`);

                    return {
                        success: true,
                        output: [...dirs, ...files].join('\n'),
                        error: undefined
                    };
                } catch (error) {
                    return {
                        success: false,
                        output: '',
                        error: `Failed to list directory: ${(error as Error).message}`
                    };
                }
            }
        });

        // Search codebase tool
        this.register({
            name: 'search_codebase',
            description: 'Search the indexed codebase for relevant files and code snippets. Returns matching files with content.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Search query - describe what you\'re looking for'
                    },
                    max_results: {
                        type: 'number',
                        description: 'Maximum number of results to return',
                        default: 5
                    }
                },
                required: ['query']
            },
            execute: async (params) => {
                try {
                    const results = await this.codebaseIndex.search(params.query, params.max_results || 5);
                    const formatted = results.map((r, i) =>
                        `[${i + 1}] ${r.path} (score: ${r.score})\n${r.preview?.slice(0, 500) || 'No preview'}...\n`
                    ).join('\n');

                    return {
                        success: true,
                        output: formatted || 'No results found',
                        error: undefined
                    };
                } catch (error) {
                    return {
                        success: false,
                        output: '',
                        error: `Search failed: ${(error as Error).message}`
                    };
                }
            }
        });

        // Run terminal command tool
        this.register({
            name: 'run_terminal',
            description: 'Execute a command in the integrated terminal. Use for npm, git, testing, builds, etc.',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'The command to execute'
                    },
                    cwd: {
                        type: 'string',
                        description: 'Working directory (optional, defaults to workspace root)'
                    },
                    timeout: {
                        type: 'number',
                        description: 'Timeout in milliseconds (optional, default 30000)',
                        default: 30000
                    }
                },
                required: ['command']
            },
            execute: async (params) => {
                try {
                    const result = await this.cleftEngine.executeCommand(params.command, {
                        timeout: params.timeout || 30000,
                        cwd: params.cwd
                    });

                    return {
                        success: result.success,
                        output: result.output,
                        error: result.error
                    };
                } catch (error) {
                    return {
                        success: false,
                        output: '',
                        error: `Command execution failed: ${(error as Error).message}`
                    };
                }
            }
        });

        // Get current file context
        this.register({
            name: 'get_current_file',
            description: 'Get information about the currently active file in the editor including content and cursor position.',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            },
            execute: async () => {
                try {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) {
                        return {
                            success: true,
                            output: 'No file currently open',
                            error: undefined
                        };
                    }

                    const document = editor.document;
                    const selection = editor.selection;

                    return {
                        success: true,
                        output: `File: ${document.fileName}
Language: ${document.languageId}
Lines: ${document.lineCount}
Cursor: Line ${selection.active.line + 1}, Char ${selection.active.character}
Selected: ${document.getText(selection) || '(nothing selected)'}

Content (first 50 lines):
${document.getText().split('\n').slice(0, 50).join('\n')}`,
                        error: undefined
                    };
                } catch (error) {
                    return {
                        success: false,
                        output: '',
                        error: `Failed to get file context: ${(error as Error).message}`
                    };
                }
            }
        });

        // Show thinking/confirmation
        this.register({
            name: 'ask_user',
            description: 'Ask the user for clarification, confirmation, or additional information. Use when you need input.',
            parameters: {
                type: 'object',
                properties: {
                    question: {
                        type: 'string',
                        description: 'The question to ask the user'
                    }
                },
                required: ['question']
            },
            execute: async (params) => {
                const answer = await vscode.window.showInputBox({
                    prompt: params.question,
                    ignoreFocusOut: true
                });

                return {
                    success: true,
                    output: answer || '(user cancelled)',
                    error: undefined
                };
            }
        });
    }

    register(tool: Tool): void {
        this.tools.set(tool.name, tool);
    }

    getTool(name: string): Tool | undefined {
        return this.tools.get(name);
    }

    getAllTools(): Tool[] {
        return Array.from(this.tools.values());
    }

    getToolsSchema(): any[] {
        return this.getAllTools().map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
            }
        }));
    }

    async executeTool(name: string, params: any): Promise<ToolResult> {
        const tool = this.tools.get(name);
        if (!tool) {
            return {
                success: false,
                output: '',
                error: `Tool '${name}' not found`
            };
        }

        try {
            return await tool.execute(params);
        } catch (error) {
            return {
                success: false,
                output: '',
                error: `Tool execution error: ${(error as Error).message}`
            };
        }
    }
}
