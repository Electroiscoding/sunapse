import * as vscode from 'vscode';
import { StateManager } from '../core/StateManager';

interface CleftTask {
    id: string;
    description: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    commands: string[];
    createdAt: number;
    result?: string;
}

export class CleftEngine {
    private context: vscode.ExtensionContext;
    private stateManager: StateManager;
    private isRunning: boolean = false;
    private currentTask: CleftTask | null = null;
    private taskQueue: CleftTask[] = [];
    private terminal: vscode.Terminal | null = null;
    private outputChannel: vscode.OutputChannel;

    constructor(context: vscode.ExtensionContext, stateManager: StateManager) {
        this.context = context;
        this.stateManager = stateManager;
        this.outputChannel = vscode.window.createOutputChannel('Synapse Cleft');
    }

    async start(): Promise<void> {
        const config = vscode.workspace.getConfiguration('synapse');
        
        if (!config.get<boolean>('cleft.enabled', false)) {
            const enable = await vscode.window.showWarningMessage(
                'Cleft autonomous commands are disabled. Enable?',
                'Yes', 'No'
            );
            if (enable === 'Yes') {
                await config.update('cleft.enabled', true, true);
            } else {
                return;
            }
        }

        this.isRunning = true;
        this.outputChannel.show();
        this.outputChannel.appendLine('[Cleft] Autonomous flow started');
        
        // Get or create terminal
        this.terminal = vscode.window.activeTerminal;
        if (!this.terminal) {
            this.terminal = vscode.window.createTerminal('Cleft');
        }
        this.terminal.show();

        // Save state
        await this.stateManager.set('cleftRunning', true);
        
        vscode.window.showInformationMessage('Cleft autonomous flow started');
    }

    async stop(): Promise<void> {
        this.isRunning = false;
        this.currentTask = null;
        this.taskQueue = [];
        
        this.outputChannel.appendLine('[Cleft] Autonomous flow stopped');
        await this.stateManager.set('cleftRunning', false);
        
        vscode.window.showInformationMessage('Cleft flow stopped');
    }

    async executeCommand(command: string, options?: {
        autoConfirm?: boolean;
        timeout?: number;
        cwd?: string;
    }): Promise<{ success: boolean; output: string; error?: string }> {
        const config = vscode.workspace.getConfiguration('synapse');
        const autoConfirm = options?.autoConfirm ?? config.get<boolean>('cleft.autoConfirm', false);
        
        // Create task
        const task: CleftTask = {
            id: Date.now().toString(),
            description: command,
            status: 'pending',
            commands: [command],
            createdAt: Date.now()
        };

        // Confirm with user unless auto-confirm is enabled
        if (!autoConfirm) {
            const choice = await vscode.window.showWarningMessage(
                `Execute: ${command}`,
                { modal: false },
                'Execute',
                'Execute & Trust',
                'Skip',
                'Stop Cleft'
            );
            
            switch (choice) {
                case 'Stop Cleft':
                    await this.stop();
                    return { success: false, output: '', error: 'Cleft stopped by user' };
                case 'Skip':
                    return { success: false, output: '', error: 'Skipped by user' };
                case 'Execute & Trust':
                    // Trust this session
                    break;
            }
        }

        // Execute
        task.status = 'running';
        this.currentTask = task;
        
        this.outputChannel.appendLine(`[Cleft] Executing: ${command}`);
        
        try {
            const result = await this.runInTerminal(command, options?.timeout);
            
            task.status = 'completed';
            task.result = result;
            
            this.outputChannel.appendLine(`[Cleft] Completed: ${command}`);
            
            return { success: true, output: result };
            
        } catch (error) {
            task.status = 'failed';
            const errorMsg = (error as Error).message;
            
            this.outputChannel.appendLine(`[Cleft] Failed: ${command} - ${errorMsg}`);
            
            return { success: false, output: '', error: errorMsg };
        }
    }

    private runInTerminal(command: string, timeout: number = 60000): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!this.terminal) {
                reject(new Error('No terminal available'));
                return;
            }

            // Use VS Code's built-in task execution for better control
            const execution = new vscode.ShellExecution(command);
            const task = new vscode.Task(
                { type: 'cleft', task: 'execute' },
                vscode.TaskScope.Workspace,
                'Cleft Command',
                'synapse',
                execution
            );

            let output = '';
            const timeoutId = setTimeout(() => {
                reject(new Error(`Command timed out after ${timeout}ms`));
            }, timeout);

            vscode.tasks.executeTask(task).then((execution: vscode.TaskExecution) => {
                const disposable = vscode.tasks.onDidEndTaskProcess((e: vscode.TaskProcessEndEvent) => {
                    if (e.execution === execution) {
                        clearTimeout(timeoutId);
                        disposable.dispose();
                        
                        if (e.exitCode === 0) {
                            resolve(output);
                        } else {
                            reject(new Error(`Exit code: ${e.exitCode}`));
                        }
                    }
                });

                // Capture output through terminal
                this.terminal!.sendText(command);
            });
        });
    }

    async executeTaskSequence(tasks: string[], options?: {
        continueOnError?: boolean;
        stopOnFailure?: boolean;
    }): Promise<{ completed: string[]; failed: string[] }> {
        const completed: string[] = [];
        const failed: string[] = [];
        
        for (const task of tasks) {
            if (!this.isRunning) break;
            
            const result = await this.executeCommand(task);
            
            if (result.success) {
                completed.push(task);
            } else {
                failed.push(task);
                
                if (options?.stopOnFailure !== false) {
                    const continueExec = await vscode.window.showWarningMessage(
                        `Task failed: ${task}`,
                        'Continue',
                        'Stop'
                    );
                    
                    if (continueExec === 'Stop') {
                        break;
                    }
                }
            }
        }
        
        return { completed, failed };
    }

    async runFlow(flowName: string, steps: Array<{
        name: string;
        command: string;
        validate?: string;
    }>): Promise<boolean> {
        this.outputChannel.appendLine(`[Cleft] Starting flow: ${flowName}`);
        
        for (const step of steps) {
            if (!this.isRunning) return false;
            
            this.outputChannel.appendLine(`[Cleft] Step: ${step.name}`);
            
            // Execute step
            const result = await this.executeCommand(step.command);
            
            if (!result.success) {
                this.outputChannel.appendLine(`[Cleft] Step failed: ${step.name}`);
                
                if (step.validate) {
                    // Try validation/recovery command
                    this.outputChannel.appendLine(`[Cleft] Running validation: ${step.validate}`);
                    await this.executeCommand(step.validate);
                }
                
                return false;
            }
        }
        
        this.outputChannel.appendLine(`[Cleft] Flow completed: ${flowName}`);
        return true;
    }

    getStatus(): {
        isRunning: boolean;
        currentTask: CleftTask | null;
        queueLength: number;
    } {
        return {
            isRunning: this.isRunning,
            currentTask: this.currentTask,
            queueLength: this.taskQueue.length
        };
    }

    dispose(): void {
        this.stop();
        this.outputChannel.dispose();
    }
}
