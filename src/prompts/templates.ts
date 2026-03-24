/**
 * Pre-configured prompts for Synapse AI
 */

export interface PromptTemplate {
    id: string;
    name: string;
    icon: string;
    category: 'code' | 'debug' | 'refactor' | 'test' | 'docs' | 'other';
    prompt: string;
    agent?: string;
}

export const QUICK_PROMPTS: PromptTemplate[] = [
    {
        id: 'explain-code',
        name: 'Explain Code',
        icon: '📖',
        category: 'code',
        prompt: 'Explain the current code in detail. Include: 1) What the code does, 2) How it works step by step, 3) Any important patterns or techniques used.',
        agent: 'coder'
    },
    {
        id: 'refactor-code',
        name: 'Refactor',
        icon: '✨',
        category: 'refactor',
        prompt: 'Refactor the selected code to improve: 1) Readability, 2) Performance, 3) Maintainability. Explain the changes made.',
        agent: 'coder'
    },
    {
        id: 'find-bugs',
        name: 'Find Bugs',
        icon: '🐛',
        category: 'debug',
        prompt: 'Analyze the current code for potential bugs, edge cases, security issues, and logic errors. List each issue with severity and suggested fix.',
        agent: 'debugger'
    },
    {
        id: 'write-tests',
        name: 'Write Tests',
        icon: '🧪',
        category: 'test',
        prompt: 'Write comprehensive unit tests for the current code. Include: 1) Happy path tests, 2) Edge cases, 3) Error scenarios. Use appropriate testing framework.',
        agent: 'coder'
    },
    {
        id: 'optimize-code',
        name: 'Optimize',
        icon: '⚡',
        category: 'refactor',
        prompt: 'Optimize the current code for better performance. Identify bottlenecks and provide faster alternatives with benchmarks if possible.',
        agent: 'coder'
    },
    {
        id: 'add-types',
        name: 'Add Types',
        icon: '📝',
        category: 'code',
        prompt: 'Add or improve TypeScript type definitions. Ensure all functions, parameters, and return types are properly typed with strict types.',
        agent: 'coder'
    },
    {
        id: 'document-code',
        name: 'Document',
        icon: '📚',
        category: 'docs',
        prompt: 'Add comprehensive documentation: 1) JSDoc/TSDoc comments, 2) README section, 3) Usage examples, 4) API reference.',
        agent: 'docs'
    },
    {
        id: 'review-code',
        name: 'Code Review',
        icon: '👁️',
        category: 'code',
        prompt: 'Perform a thorough code review. Check: 1) Code style, 2) Best practices, 3) Security, 4) Performance, 5) Maintainability. Provide actionable feedback.',
        agent: 'critic'
    },
    {
        id: 'design-pattern',
        name: 'Apply Pattern',
        icon: '🏗️',
        category: 'refactor',
        prompt: 'Identify opportunities to apply design patterns (Factory, Singleton, Observer, etc.) to improve the code structure. Explain the pattern and implement it.',
        agent: 'architect'
    },
    {
        id: 'fix-errors',
        name: 'Fix Errors',
        icon: '🔧',
        category: 'debug',
        prompt: 'Fix all compilation/runtime errors in the current file. Explain what was wrong and how you fixed it.',
        agent: 'debugger'
    },
    {
        id: 'modernize-code',
        name: 'Modernize',
        icon: '🚀',
        category: 'refactor',
        prompt: 'Modernize the code using latest language features and best practices. Convert to async/await, use modern syntax, leverage new APIs.',
        agent: 'coder'
    },
    {
        id: 'security-audit',
        name: 'Security Audit',
        icon: '🔒',
        category: 'code',
        prompt: 'Perform a security audit. Check for: 1) Injection vulnerabilities, 2) XSS/CSRF, 3) Data exposure, 4) Authentication issues, 5) Secrets in code.',
        agent: 'critic'
    },
    {
        id: 'extract-function',
        name: 'Extract Function',
        icon: '📦',
        category: 'refactor',
        prompt: 'Extract reusable functions from the current code. Identify duplication and create well-named, single-purpose functions.',
        agent: 'coder'
    },
    {
        id: 'add-error-handling',
        name: 'Add Error Handling',
        icon: '🛡️',
        category: 'code',
        prompt: 'Add comprehensive error handling with try/catch blocks, error logging, user-friendly messages, and proper cleanup.',
        agent: 'coder'
    },
    {
        id: 'improve-naming',
        name: 'Better Naming',
        icon: '🏷️',
        category: 'refactor',
        prompt: 'Improve variable, function, and class names to be more descriptive and follow naming conventions. Explain each change.',
        agent: 'coder'
    },
    {
        id: 'generate-api',
        name: 'Generate API',
        icon: '🔌',
        category: 'code',
        prompt: 'Design and implement a REST/GraphQL API based on the current models/code. Include routes, controllers, validation, and documentation.',
        agent: 'architect'
    },
    {
        id: 'sql-optimization',
        name: 'Optimize SQL',
        icon: '🗄️',
        category: 'code',
        prompt: 'Optimize SQL queries. Check: 1) Index usage, 2) N+1 problems, 3) Unnecessary joins, 4) Query complexity. Provide improved queries.',
        agent: 'coder'
    },
    {
        id: 'accessibility',
        name: 'Accessibility',
        icon: '♿',
        category: 'code',
        prompt: 'Improve accessibility compliance (WCAG). Check: 1) ARIA labels, 2) Color contrast, 3) Keyboard navigation, 4) Screen reader support.',
        agent: 'critic'
    },
    {
        id: 'responsive-design',
        name: 'Responsive Design',
        icon: '📱',
        category: 'code',
        prompt: 'Make the UI responsive for all screen sizes. Use flexible layouts, media queries, and mobile-first approach.',
        agent: 'architect'
    },
    {
        id: 'dependency-check',
        name: 'Check Dependencies',
        icon: '📋',
        category: 'other',
        prompt: 'Analyze dependencies for: 1) Security vulnerabilities, 2) Outdated packages, 3) License compatibility, 4) Bundle size impact.',
        agent: 'critic'
    }
];

export function getPromptById(id: string): PromptTemplate | undefined {
    return QUICK_PROMPTS.find(p => p.id === id);
}

export function getPromptsByCategory(category: string): PromptTemplate[] {
    return QUICK_PROMPTS.filter(p => p.category === category);
}

export function getDefaultQuickPrompts(): PromptTemplate[] {
    return [
        QUICK_PROMPTS[0], // Explain
        QUICK_PROMPTS[1], // Refactor
        QUICK_PROMPTS[2], // Find bugs
        QUICK_PROMPTS[3], // Write tests
    ];
}

export const SYSTEM_PROMPTS = {
    codeReview: `You are a senior code reviewer with expertise in software engineering best practices.

Review the code for:
1. Correctness - Does it work as intended?
2. Performance - Any bottlenecks or inefficiencies?
3. Security - Potential vulnerabilities?
4. Maintainability - Clean code principles, readability
5. Testing - Test coverage and quality
6. Architecture - Design patterns and structure

Format your review as:
- Summary (2-3 sentences)
- Critical issues (must fix)
- Warnings (should fix)
- Suggestions (nice to have)
- Positive feedback (what's good)

Be specific with line references and provide code examples for fixes.`,

    architecture: `You are a software architect specializing in system design.

When designing or reviewing architecture:
1. Consider scalability and performance
2. Evaluate trade-offs (complexity vs simplicity)
3. Follow SOLID principles
4. Consider deployment and operational concerns
5. Plan for future extensibility
6. Document architectural decisions

Provide clear diagrams or structure descriptions. Include rationale for key decisions.`,

    debugging: `You are a debugging expert specializing in finding and fixing software bugs.

Approach to debugging:
1. Reproduce and understand the error
2. Trace through execution paths
3. Identify root cause (not just symptoms)
4. Verify assumptions and invariants
5. Propose minimal, targeted fixes
6. Suggest prevention strategies

Always explain your reasoning and provide test cases to verify fixes.`,

    refactoring: `You are a refactoring specialist focused on improving code quality.

Refactoring principles:
1. Preserve behavior (no functional changes)
2. Small, incremental steps
3. Maintain test compatibility
4. Improve readability and maintainability
5. Reduce complexity and duplication
6. Follow language-specific idioms

Explain each refactoring step and its benefits.`,

    performance: `You are a performance optimization expert.

Optimization approach:
1. Profile before optimizing
2. Focus on hot paths
3. Algorithmic improvements over micro-optimizations
4. Consider space-time trade-offs
5. Benchmark changes
6. Document optimization rationale

Provide before/after comparisons with measurements.`
};
