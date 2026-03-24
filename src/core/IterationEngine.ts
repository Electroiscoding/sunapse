import { AgentOrchestrator } from '../agents/AgentOrchestrator';
import { StateManager } from './StateManager';
import { CleftEngine } from '../cleft/CleftEngine';

interface Checkpoint {
    id: string;
    timestamp: number;
    task: string;
    progress: string;
    filesModified: string[];
    context: any;
}

interface IterationTask {
    id: string;
    description: string;
    status: 'running' | 'paused' | 'completed' | 'failed';
    startTime: number;
    checkpoints: Checkpoint[];
    currentStep: number;
    totalSteps: number;
}

export class IterationEngine {
    private agentOrchestrator: AgentOrchestrator;
    private stateManager: StateManager;
    private cleftEngine: CleftEngine;
    private activeTask: IterationTask | null = null;
    private intervalId: ReturnType<typeof setInterval> | null = null;
    private isRestored: boolean = false;

    constructor(
        agentOrchestrator: AgentOrchestrator,
        stateManager: StateManager,
        cleftEngine: CleftEngine
    ) {
        this.agentOrchestrator = agentOrchestrator;
        this.stateManager = stateManager;
        this.cleftEngine = cleftEngine;
    }

    async start(task: string, checkpoints?: string[]): Promise<void> {
        // Stop any existing iteration
        if (this.activeTask) {
            await this.stop();
        }

        // Create new task
        this.activeTask = {
            id: Date.now().toString(),
            description: task,
            status: 'running',
            startTime: Date.now(),
            checkpoints: [],
            currentStep: 0,
            totalSteps: checkpoints?.length || 10
        };

        // Save to state
        await this.stateManager.set('iterationActive', true);
        await this.stateManager.set('currentIterationTask', this.activeTask);

        // Start checkpoint interval
        const config = await this.stateManager.get('iteration.checkpointInterval', 300) as number;
        this.intervalId = setInterval(() => this.createCheckpoint(), config * 1000);

        // Begin first iteration
        this.runIteration();

        console.log(`[Iteration] Started: ${task}`);
    }

    async stop(): Promise<void> {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        if (this.activeTask) {
            this.activeTask.status = 'paused';
            await this.createCheckpoint(); // Final checkpoint
            await this.stateManager.set('currentIterationTask', this.activeTask);
        }

        await this.stateManager.set('iterationActive', false);
        console.log('[Iteration] Stopped');
    }

    async restore(): Promise<void> {
        if (this.isRestored) return;

        const saved = this.stateManager.get<IterationTask>('currentIterationTask');
        if (saved && saved.status === 'running') {
            this.activeTask = saved;
            
            // Resume checkpoint interval
            const config = this.stateManager.get<number>('iteration.checkpointInterval', 300) || 300;
            this.intervalId = setInterval(() => this.createCheckpoint(), config * 1000);
            
            this.isRestored = true;
            console.log(`[Iteration] Restored: ${saved.description}`);
            
            // Continue from last checkpoint
            this.runIteration();
        }
    }

    private async runIteration(): Promise<void> {
        if (!this.activeTask || this.activeTask.status !== 'running') return;

        try {
            // Get current code context
            const editor = await this.getActiveEditorContent();
            
            // Build prompt for next iteration step
            const prompt = this.buildIterationPrompt(
                this.activeTask,
                editor
            );

            // Execute through agent orchestrator
            // This would integrate with the provider for autonomous execution
            console.log(`[Iteration] Step ${this.activeTask.currentStep + 1}/${this.activeTask.totalSteps}`);

            this.activeTask.currentStep++;
            
            // Auto-continue if not complete
            if (this.activeTask.currentStep < this.activeTask.totalSteps) {
                // Schedule next iteration after delay
                setTimeout(() => this.runIteration(), 5000);
            } else {
                this.activeTask.status = 'completed';
                await this.stateManager.set('iterationActive', false);
            }

            await this.stateManager.set('currentIterationTask', this.activeTask);

        } catch (error) {
            console.error('[Iteration] Error:', error);
            this.activeTask.status = 'failed';
            await this.stateManager.set('currentIterationTask', this.activeTask);
        }
    }

    private buildIterationPrompt(task: IterationTask, context: any): string {
        return `
You are in 24/7 autonomous iteration mode for the task: "${task.description}"

Current Progress:
- Step ${task.currentStep} of ${task.totalSteps}
- Running for ${Math.floor((Date.now() - task.startTime) / 1000)}s

Current Code Context:
${context ? `File: ${context.fileName}\n\n${context.content.slice(0, 1000)}` : 'No active editor'}

Your task:
1. Analyze the current state
2. Make incremental progress toward the goal
3. Follow best practices and maintain code quality
4. Create a checkpoint after each significant change
5. Continue autonomously until the task is complete

Execute the next logical step. Use EDIT, TERMINAL, or FILE actions as needed.
        `.trim();
    }

    private async createCheckpoint(): Promise<void> {
        if (!this.activeTask) return;

        const checkpoint: Checkpoint = {
            id: Date.now().toString(),
            timestamp: Date.now(),
            task: this.activeTask.description,
            progress: `Step ${this.activeTask.currentStep}/${this.activeTask.totalSteps}`,
            filesModified: [], // Would track actual modified files
            context: {
                agentState: this.agentOrchestrator.getActiveAgents(),
                iterationState: this.activeTask
            }
        };

        this.activeTask.checkpoints.push(checkpoint);
        await this.stateManager.saveCheckpoint(checkpoint);
        
        console.log(`[Iteration] Checkpoint created: ${checkpoint.id}`);
    }

    async restoreCheckpoint(checkpointId: string): Promise<boolean> {
        const checkpoint = await this.stateManager.restoreCheckpoint(checkpointId);
        if (!checkpoint) {
            console.error(`[Iteration] Checkpoint not found: ${checkpointId}`);
            return false;
        }

        // Restore context
        if (this.activeTask) {
            this.activeTask.currentStep = parseInt(checkpoint.progress.split('/')[0]) - 1;
        }

        console.log(`[Iteration] Restored to checkpoint: ${checkpointId}`);
        return true;
    }

    private async getActiveEditorContent(): Promise<{ fileName: string; content: string } | null> {
        // This would get content from the webview or extension host
        // For now return null as actual implementation would need message passing
        return null;
    }

    getStatus(): {
        active: boolean;
        task: IterationTask | null;
        elapsedTime: number;
    } {
        if (!this.activeTask) {
            return { active: false, task: null, elapsedTime: 0 };
        }

        return {
            active: this.activeTask.status === 'running',
            task: this.activeTask,
            elapsedTime: Date.now() - this.activeTask.startTime
        };
    }

    getCheckpoints(): Checkpoint[] {
        return this.activeTask?.checkpoints || this.stateManager.getCheckpoints();
    }

    dispose(): void {
        this.stop();
    }
}
