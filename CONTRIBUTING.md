# Contributing to Synapse AI

Thank you for your interest in contributing to Synapse AI! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Submitting Changes](#submitting-changes)
- [Coding Standards](#coding-standards)
- [Commit Messages](#commit-messages)

## Code of Conduct

This project and everyone participating in it is governed by our commitment to:
- Be respectful and inclusive
- Welcome newcomers
- Focus on constructive feedback
- Prioritize user experience

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally
3. Create a new branch for your feature or bug fix
4. Make your changes
5. Submit a pull request

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [VS Code](https://code.visualstudio.com/)
- Git

### Installation

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/synapse.git
cd synapse

# Install dependencies
npm install

# Compile the extension
npm run compile

# Open in VS Code
code .
```

### Running the Extension

Press `F5` to open a new Extension Development Host window with the extension loaded.

## Making Changes

### Project Structure

```
synapse/
├── src/
│   ├── agents/           # Multi-agent system
│   ├── providers/        # AI provider integrations
│   ├── indexing/         # Codebase indexing
│   ├── cleft/           # Autonomous terminal
│   ├── core/            # Core utilities
│   ├── ui/              # Webview UI
│   ├── prompts/         # Prompt templates
│   └── utils/           # Helper functions
├── media/               # UI assets (CSS, JS)
├── resources/           # Icons and images
└── .github/            # GitHub workflows
```

### Adding a New Agent

1. Define the agent in `src/agents/AgentOrchestrator.ts`
2. Add system prompt with capabilities
3. Register in `initializeDefaultAgents()`
4. Update documentation

Example:
```typescript
this.agents.set('myagent', {
    name: 'My Agent',
    description: 'What this agent does',
    capabilities: ['capability1', 'capability2'],
    systemPrompt: `Detailed instructions...`
});
```

### Adding a New Provider

1. Add provider config to `src/providers/ProviderManager.ts`
2. Implement request formatting and response parsing
3. Add to provider enum in `package.json`
4. Update settings schema

### UI Changes

1. Modify `media/styles.css` for styling
2. Update `media/main.js` for interactions
3. Update `src/ui/SynapsePanel.ts` for webview HTML

## Submitting Changes

### Pull Request Process

1. **Create a branch**: `git checkout -b feature/your-feature-name`
2. **Make changes**: Write code following our standards
3. **Test locally**: Run `npm run compile` and test in Extension Host
4. **Lint**: Run `npm run lint` and fix any issues
5. **Commit**: Write clear commit messages (see below)
6. **Push**: `git push origin feature/your-feature-name`
7. **Create PR**: Open a pull request with clear description

### PR Requirements

- Clear title and description
- Reference any related issues
- Include screenshots for UI changes
- Ensure all checks pass
- Request review from maintainers

## Coding Standards

### TypeScript

- Use strict TypeScript settings
- Explicit return types on public methods
- Interface over type alias for object shapes
- Avoid `any` - use `unknown` when necessary

```typescript
// Good
interface AgentConfig {
    name: string;
    capabilities: string[];
}

function getAgent(id: string): AgentConfig | undefined {
    // implementation
}

// Avoid
function getAgent(id: any): any {
    // implementation
}
```

### Code Style

- 4 spaces indentation
- Single quotes for strings
- Semicolons required
- Max line length: 120 characters
- Meaningful variable names

### Error Handling

```typescript
// Good
try {
    await riskyOperation();
} catch (error) {
    if (error instanceof SpecificError) {
        handleSpecific(error);
    } else {
        console.error('Unexpected error:', error);
        throw error;
    }
}

// Avoid
try {
    await riskyOperation();
} catch (e) {
    // silent failure
}
```

## Commit Messages

Use conventional commits format:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `test`: Test changes
- `chore`: Build/config changes

Examples:
```
feat(agents): add security audit agent

Implements a new agent specialized in finding
security vulnerabilities and suggesting fixes.

fix(providers): handle OpenRouter rate limiting

Adds exponential backoff for 429 responses.
```

## Questions?

- Open an issue for bugs or feature requests
- Join discussions for general questions
- Check existing issues/PRs before creating new ones

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing to Synapse AI!** ⚡
