# Changelog

All notable changes to the Synapse AI extension will be documented in this file.

## [1.0.0] - 2026-03-24

### Added
- Initial release of Synapse AI VS Code Extension
- **Windsurf-Style UI**: Right panel chat interface with modern dark theme
- **Multi-Agent System**: 6 built-in agents (Coder, Orchestrator, Critic, Architect, Debugger, Documentation)
- **Custom Agents**: Create user-defined specialized agents
- **Cleft - Autonomous Terminal Flows**: Execute commands with confirmation system
- **Codebase Indexing**: Full workspace semantic search
- **24/7 Iteration Mode**: Continuous autonomous operation with checkpoints
- **BYOM & BYOK Support**: 
  - OpenRouter integration (100+ models)
  - HuggingFace support
  - OpenAI support
  - Anthropic support
  - Custom API endpoints
- **No Cold Start**: Session state preservation with model context maintenance
- **Streaming Responses**: Real-time AI response streaming
- **Code Context Awareness**: Current file and selection context
- **Suggested Actions**: Apply edits, run commands from AI suggestions
- **Secure API Key Storage**: VS Code SecretStorage API integration

### Features
- Command palette integration (`Ctrl+Shift+A` to open panel)
- Quick action buttons for common tasks
- Agent selection dropdown
- Auto-indexing on startup (configurable)
- Checkpoint-based 24/7 iteration
- Configurable temperature and max tokens
- File editing with preview
- Terminal command execution
- Conversation history management

### Security
- API keys stored securely using VS Code's SecretStorage
- Terminal commands require user confirmation (configurable)
- File edits previewed before application
- No data sent to external servers except configured AI provider

[1.0.0]: https://github.com/synapse-ai/synapse/releases/tag/v1.0.0
