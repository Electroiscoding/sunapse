import * as vscode from 'vscode';
import { ProviderManager } from '../providers/ProviderManager';
import { StateManager } from '../core/StateManager';

export interface Agent {
    name: string;
    description: string;
    systemPrompt: string;
    capabilities: string[];
}

export class AgentOrchestrator {
    private providerManager: ProviderManager;
    private stateManager: StateManager;
    private agents: Map<string, Agent> = new Map();
    private customAgents: Map<string, Agent> = new Map();

    constructor(providerManager: ProviderManager, stateManager: StateManager) {
        this.providerManager = providerManager;
        this.stateManager = stateManager;
        this.initializeDefaultAgents();
        this.loadCustomAgents();
    }

    private initializeDefaultAgents(): void {
        // Coder Agent - Primary coding assistant
        this.agents.set('coder', {
            name: 'Coder',
            description: 'Expert software developer focused on writing, editing, and refactoring code',
            capabilities: ['write_code', 'edit_code', 'refactor', 'debug', 'explain_code'],
            systemPrompt: `You are an expert software developer with deep knowledge of multiple programming languages, frameworks, and best practices.
Your role is to:
1. Write clean, efficient, and well-documented code
2. Refactor and improve existing code
3. Debug issues and provide solutions
4. Explain code functionality clearly
5. Follow language-specific conventions and best practices

When providing code:
- Use proper syntax and formatting
- Include helpful comments
- Consider edge cases and error handling
- Write maintainable and scalable solutions
- Suggest improvements when applicable

Always wrap code blocks with appropriate file paths and line numbers when editing existing files.`
        });

        // Orchestrator Agent - Coordinates other agents
        this.agents.set('orchestrator', {
            name: 'Orchestrator',
            description: 'Coordinates multiple agents and manages complex multi-step tasks',
            capabilities: ['plan', 'coordinate', 'delegate', 'review', 'synthesize'],
            systemPrompt: `You are the Orchestrator agent responsible for coordinating complex tasks across multiple specialized agents.
Your role is to:
1. Analyze user requests and break them down into subtasks
2. Determine which agents are needed for each subtask
3. Create execution plans with clear steps
4. Synthesize results from multiple agents
5. Ensure quality and completeness of deliverables

When planning:
- Identify dependencies between tasks
- Allocate work to appropriate agents
- Set clear success criteria
- Monitor progress and adjust as needed
- Provide comprehensive final responses

Use tags like [AGENT:coders] or [AGENT:architect] to indicate which agents should handle specific subtasks.`
        });

        // Critic/Reviewer Agent - Reviews and validates
        this.agents.set('critic', {
            name: 'Critic',
            description: 'Code reviewer that finds issues, suggests improvements, and ensures quality',
            capabilities: ['review', 'find_bugs', 'suggest_improvements', 'security_audit', 'performance_review'],
            systemPrompt: `You are a meticulous code reviewer and quality assurance specialist.
Your role is to:
1. Identify bugs, logic errors, and potential issues
2. Check for security vulnerabilities
3. Review code style and adherence to best practices
4. Assess performance implications
5. Verify test coverage
6. Suggest concrete improvements

When reviewing:
- Be thorough and systematic
- Categorize issues by severity (critical/warning/suggestion)
- Provide specific line references
- Suggest concrete fixes with code examples
- Consider edge cases and error scenarios
- Check for common anti-patterns

Format: Start with overall assessment, then detailed findings with severity levels.`
        });

        // Architect Agent - High-level design and structure
        this.agents.set('architect', {
            name: 'Architect',
            description: 'Designs system architecture, APIs, and overall code structure',
            capabilities: ['design_architecture', 'design_api', 'structure_code', 'tech_decisions', 'scalability'],
            systemPrompt: `You are a software architect specializing in system design and technical decision-making.
Your role is to:
1. Design system architectures and component structures
2. Define API contracts and interfaces
3. Make technology recommendations
4. Plan for scalability and maintainability
5. Establish coding standards and patterns
6. Create migration strategies

When designing:
- Consider trade-offs (performance vs simplicity vs maintainability)
- Plan for future extensibility
- Address security and reliability
- Provide clear diagrams or structure descriptions
- Document architectural decisions (ADRs)
- Consider deployment and operational concerns

Format: High-level overview first, then detailed component breakdown.`
        });

        // Debugger Agent - Specialized debugging
        this.agents.set('debugger', {
            name: 'Debugger',
            description: 'Expert at finding and fixing bugs, analyzing errors, and tracing issues',
            capabilities: ['trace_errors', 'analyze_stack_traces', 'find_root_cause', 'propose_fixes', 'prevention'],
            systemPrompt: `You are a debugging specialist with expertise in tracing errors and finding root causes.
Your role is to:
1. Analyze error messages and stack traces
2. Trace through code execution paths
3. Identify root causes of bugs
4. Propose and implement fixes
5. Suggest debugging strategies
6. Recommend prevention measures

When debugging:
- Methodically work through the error
- Check assumptions and invariants
- Consider environmental factors
- Verify data flow and state changes
- Test hypotheses systematically
- Provide clear reproduction steps

Format: Start with error analysis, then root cause identification, then solution.`
        });

        // Documentation Agent - Creates and maintains docs
        this.agents.set('docs', {
            name: 'Documentation',
            description: 'Creates comprehensive documentation, READMEs, and API docs',
            capabilities: ['write_docs', 'write_readme', 'document_api', 'code_comments', 'tutorials'],
            systemPrompt: `You are a technical writer specializing in software documentation.
Your role is to:
1. Write clear and comprehensive README files
2. Document APIs with examples
3. Add helpful code comments
4. Create usage tutorials and guides
5. Maintain changelogs
6. Write architecture documentation

When documenting:
- Start with the "why" before the "how"
- Include practical examples
- Use clear, concise language
- Structure information logically
- Consider different audience levels
- Keep documentation up-to-date

Format: Overview, usage, examples, and reference sections as appropriate.`
        });
    }

    private async loadCustomAgents(): Promise<void> {
        const customAgentsData = this.stateManager.get<Agent[]>('customAgents', []);
        for (const agent of customAgentsData || []) {
            this.customAgents.set(agent.name.toLowerCase().replace(/\s+/g, '_'), agent);
        }
    }

    getAgent(name: string): Agent | undefined {
        return this.agents.get(name) || this.customAgents.get(name);
    }

    getAllAgents(): Agent[] {
        return [
            ...Array.from(this.agents.values()),
            ...Array.from(this.customAgents.values())
        ];
    }

    getActiveAgents(): string[] {
        const config = vscode.workspace.getConfiguration('synapse');
        return config.get<string[]>('agents.activeAgents', ['coder', 'orchestrator']);
    }

    async addCustomAgent(): Promise<void> {
        const name = await vscode.window.showInputBox({
            prompt: 'Agent name (e.g., Security Expert)',
            placeHolder: 'My Custom Agent'
        });
        
        if (!name) return;

        const description = await vscode.window.showInputBox({
            prompt: 'Short description of what this agent does',
            placeHolder: 'Specializes in security audits and vulnerability detection'
        });
        
        if (!description) return;

        const capabilitiesInput = await vscode.window.showInputBox({
            prompt: 'Capabilities (comma-separated)',
            placeHolder: 'security_audit, vulnerability_scan, threat_modeling'
        });
        
        const capabilities = capabilitiesInput?.split(',').map((c: string) => c.trim()) || [];

        const systemPrompt = await vscode.window.showInputBox({
            prompt: 'System prompt (detailed instructions for the agent)',
            placeHolder: 'You are a security expert specializing in...',
            ignoreFocusOut: true
        });
        
        if (!systemPrompt) return;

        const agent: Agent = {
            name,
            description,
            capabilities,
            systemPrompt
        };

        const key = name.toLowerCase().replace(/\s+/g, '_');
        this.customAgents.set(key, agent);

        // Save to state
        const existing = this.stateManager.get<Agent[]>('customAgents', []);
        await this.stateManager.set('customAgents', [...(existing || []), agent]);

        vscode.window.showInformationMessage(`Custom agent "${name}" created successfully!`);
    }

    getSystemPrompt(codeContext: any, relevantFiles: any[]): string {
        const activeAgents = this.getActiveAgents();
        const primaryAgent = activeAgents[0] || 'coder';
        const agent = this.getAgent(primaryAgent);

        let prompt = agent?.systemPrompt || this.agents.get('coder')!.systemPrompt;

        // Add context about available agents
        prompt += '\n\n## Available Agents\n';
        for (const agentName of activeAgents) {
            const a = this.getAgent(agentName);
            if (a) {
                prompt += `- ${a.name}: ${a.description}\n`;
            }
        }

        // Add codebase context
        if (relevantFiles.length > 0) {
            prompt += '\n\n## Relevant Files from Codebase\n';
            for (const file of relevantFiles.slice(0, 10)) {
                prompt += `File: ${file.path}\n${file.content?.slice(0, 500) || 'Indexed file'}\n\n`;
            }
        }

        // Add current file context
        if (codeContext) {
            prompt += '\n\n## Current File Context\n';
            prompt += `File: ${codeContext.filePath}\n`;
            prompt += `Language: ${codeContext.language}\n`;
            if (codeContext.selectedText) {
                prompt += `\nSelected code:\n${codeContext.selectedText}\n`;
            }
        }

        // Add action formatting instructions
        prompt += `\n\n## Action Format\nWhen you want to perform actions, use these formats:
- EDIT file_path:line_start-line_end\`\`\`language\ncode\`\`\`
- TERMINAL: command
- FILE: path/to/file (for new files)
- ASK: follow-up question for clarification

The user will review and confirm each action before execution.`;

        return prompt;
    }

    async processResponse(
        response: string,
        handlers: {
            onEdit: (edit: { file: string; range: any; content: string }) => void;
            onTerminal: (cmd: string) => void;
            onFile: (file: { path: string; content: string }) => void;
        }
    ): Promise<void> {
        // Extract EDIT actions
        const editRegex = /EDIT\s+(\S+):(\d+)-(\d+)\s*```\w*\n([\s\S]*?)```/g;
        let match: RegExpExecArray | null;
        while ((match = editRegex.exec(response)) !== null) {
            handlers.onEdit({
                file: match[1],
                range: {
                    start: { line: parseInt(match[2]) - 1, character: 0 },
                    end: { line: parseInt(match[3]), character: 0 }
                },
                content: match[4].trim()
            });
        }

        // Extract TERMINAL actions
        const terminalRegex = /TERMINAL:\s*(.+)/g;
        while ((match = terminalRegex.exec(response)) !== null) {
            handlers.onTerminal(match[1].trim());
        }

        // Extract FILE actions (new files)
        const fileRegex = /FILE:\s*(\S+)\s*```\w*\n([\s\S]*?)```/g;
        while ((match = fileRegex.exec(response)) !== null) {
            handlers.onFile({
                path: match[1],
                content: match[2].trim()
            });
        }

        // If response suggests using another agent, delegate
        const agentRegex = /\[AGENT:(\w+)\]/g;
        const agentMatches = [...response.matchAll(agentRegex)];
        if (agentMatches.length > 0) {
            for (const agentMatch of agentMatches) {
                const agentName = agentMatch[1].toLowerCase();
                const delegatedAgent = this.getAgent(agentName);
                if (delegatedAgent) {
                    // Could trigger delegation logic here
                    console.log(`Would delegate to ${delegatedAgent.name}`);
                }
            }
        }
    }
}
