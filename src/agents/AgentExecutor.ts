import * as vscode from 'vscode';
import { ToolRegistry, ToolResult } from './ToolRegistry';
import { ProviderManager } from '../providers/ProviderManager';
import { getComponentLogger } from '../logging/Logger';

interface ToolCall {
    name: string;
    arguments: any;
}

interface AgentStep {
    type: 'thought' | 'action' | 'observation' | 'final';
    content: string;
    toolCall?: ToolCall;
    toolResult?: ToolResult;
}

export class AgentExecutor {
    private toolRegistry: ToolRegistry;
    private providerManager: ProviderManager;
    private maxSteps: number = 50;
    private steps: AgentStep[] = [];
    private log = getComponentLogger('AgentExecutor');

    constructor(toolRegistry: ToolRegistry, providerManager: ProviderManager) {
        this.toolRegistry = toolRegistry;
        this.providerManager = providerManager;
    }

    async execute(userRequest: string, onUpdate: (step: AgentStep) => void): Promise<string> {
        this.steps = [];
        this.log.info('Starting agent execution', { request: userRequest });

        const systemPrompt = this.buildSystemPrompt();
        let currentIteration = 0;
        let context = `User request: ${userRequest}\n\n`;

        while (currentIteration < this.maxSteps) {
            currentIteration++;
            this.log.info(`Step ${currentIteration}`);

            // Get AI response
            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: context }
            ];

            let aiResponse = '';
            try {
                for await (const chunk of this.providerManager.streamCompletion(messages, { maxTokens: 2000 })) {
                    aiResponse += chunk;
                }
            } catch (error) {
                this.log.error('AI response failed', { error: (error as Error).message });
                return `Error: AI failed to respond - ${(error as Error).message}`;
            }

            // Parse the AI response to extract thoughts and actions
            const parsed = this.parseAIResponse(aiResponse);

            if (parsed.thought) {
                const thoughtStep: AgentStep = {
                    type: 'thought',
                    content: parsed.thought
                };
                this.steps.push(thoughtStep);
                onUpdate(thoughtStep);
                context += `Thought: ${parsed.thought}\n\n`;
            }

            // Check if AI wants to use a tool
            if (parsed.toolCall) {
                const actionStep: AgentStep = {
                    type: 'action',
                    content: `Using tool: ${parsed.toolCall.name}`,
                    toolCall: parsed.toolCall
                };
                this.steps.push(actionStep);
                onUpdate(actionStep);

                // Execute the tool
                this.log.info('Executing tool', { tool: parsed.toolCall.name, args: parsed.toolCall.arguments });
                const result = await this.toolRegistry.executeTool(
                    parsed.toolCall.name,
                    parsed.toolCall.arguments
                );

                const observationStep: AgentStep = {
                    type: 'observation',
                    content: result.success ? result.output : `Error: ${result.error}`,
                    toolResult: result
                };
                this.steps.push(observationStep);
                onUpdate(observationStep);

                // Add to context for next iteration
                context += `Action: ${parsed.toolCall.name}(${JSON.stringify(parsed.toolCall.arguments)})\n`;
                context += `Observation: ${result.success ? result.output : `Error: ${result.error}`}\n\n`;

                // If tool failed, let AI know and continue
                if (!result.success) {
                    context += `The previous action failed. Please try a different approach or ask the user for help.\n\n`;
                }
            }

            // Check if AI has a final answer
            if (parsed.finalAnswer) {
                const finalStep: AgentStep = {
                    type: 'final',
                    content: parsed.finalAnswer
                };
                this.steps.push(finalStep);
                onUpdate(finalStep);
                this.log.info('Agent execution complete', { steps: currentIteration });
                return parsed.finalAnswer;
            }

            // Prevent infinite loops
            if (currentIteration >= this.maxSteps) {
                const timeoutMsg = 'Agent reached maximum step limit. Task may be incomplete.';
                const finalStep: AgentStep = {
                    type: 'final',
                    content: timeoutMsg
                };
                onUpdate(finalStep);
                return timeoutMsg;
            }
        }

        return 'Agent execution ended unexpectedly.';
    }

    private buildSystemPrompt(): string {
        const tools = this.toolRegistry.getAllTools();
        const toolsDescription = tools.map(t => {
            const params = Object.entries(t.parameters.properties)
                .map(([name, desc]: [string, any]) => `    - ${name}: ${desc.description}`)
                .join('\n');
            return `- ${t.name}: ${t.description}\n  Parameters:\n${params}`;
        }).join('\n\n');

        return `You are an autonomous AI coding agent with the ability to use tools to complete tasks. You operate in a ReAct (Reasoning and Acting) loop.

## Available Tools
${toolsDescription}

## How to Use Tools
When you want to use a tool, respond in this exact format:

<tool>
{"name": "tool_name", "arguments": {"param1": "value1", "param2": "value2"}}
</tool>

## How to Provide Final Answer
When you have completed the task and have a final answer, respond with:

<final>
Your final response to the user
</final>

## Workflow
1. **Think**: Analyze the request and plan your approach
2. **Act**: Use tools to gather information or make changes
3. **Observe**: Review the results from tools
4. **Repeat**: Continue until the task is complete
5. **Final Answer**: Provide your response when done

## Guidelines
- Always explore the codebase before making changes
- Read files to understand context before editing
- Use edit_file for precise changes, write_file for new files
- Run tests/verification after making changes
- If a tool fails, try an alternative approach
- Ask the user for clarification if the request is unclear
- Be thorough - check multiple files if needed
- Use search_codebase to find relevant code quickly

## Example Session
Thought: I need to understand the project structure first.
<tool>
{"name": "list_dir", "arguments": {"dir_path": "/workspace"}}
</tool>

[Wait for observation...]

Thought: Now I'll check the package.json to understand dependencies.
<tool>
{"name": "read_file", "arguments": {"file_path": "/workspace/package.json"}}
</tool>

[Continue until task is complete, then:]

<final>
I've analyzed the codebase and completed the requested changes. The new feature has been added to src/features/newFeature.ts and integrated into the main application.
</final>

You are now ready to help the user. What's the task?`;
    }

    private parseAIResponse(response: string): {
        thought?: string;
        toolCall?: ToolCall;
        finalAnswer?: string;
    } {
        const result: any = {};

        // Extract thought (everything before any tool or final tag)
        const toolMatch = response.match(/<tool>\s*([\s\S]*?)\s*<\/tool>/);
        const finalMatch = response.match(/<final>\s*([\s\S]*?)\s*<\/final>/);

        if (toolMatch) {
            const beforeTool = response.split('<tool>')[0].trim();
            if (beforeTool) {
                result.thought = beforeTool;
            }
            try {
                result.toolCall = JSON.parse(toolMatch[1]);
            } catch (e) {
                result.thought = (result.thought || '') + `\n[Error parsing tool call: ${(e as Error).message}]`;
            }
        } else if (finalMatch) {
            const beforeFinal = response.split('<final>')[0].trim();
            if (beforeFinal) {
                result.thought = beforeFinal;
            }
            result.finalAnswer = finalMatch[1].trim();
        } else {
            // No tool or final tag - treat as thought
            result.thought = response.trim();
        }

        return result;
    }

    getSteps(): AgentStep[] {
        return [...this.steps];
    }
}
