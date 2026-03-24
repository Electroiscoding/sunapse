# Synapse API Reference

**Version:** 1.0.0  
**Last Updated:** March 2026

## Overview

Synapse is a production-grade AI coding assistant VS Code extension. This document provides comprehensive API documentation for all public interfaces.

## Table of Contents

- [Core APIs](#core-apis)
- [Provider APIs](#provider-apis)
- [Agent APIs](#agent-apis)
- [Indexing APIs](#indexing-apis)
- [UI APIs](#ui-apis)
- [Utility APIs](#utility-apis)
- [Security APIs](#security-apis)
- [Monitoring APIs](#monitoring-apis)

---

## Core APIs

### StateManager

Persistent state management for session, global, and secret storage.

```typescript
import { StateManager } from './core/StateManager';

class StateManager {
  // Get singleton instance
  static getInstance(context: vscode.ExtensionContext): StateManager;

  // Session state (in-memory, cleared on restart)
  getSession<T>(key: string): T | undefined;
  setSession<T>(key: string, value: T): void;
  clearSession(): void;

  // Global state (persists across restarts)
  get<T>(key: string, defaultValue?: T): T;
  async set<T>(key: string, value: T): Promise<void>;

  // Secrets (encrypted storage)
  async getSecret(key: string): Promise<string | undefined>;
  async storeSecret(key: string, value: string): Promise<void>;
  async deleteSecret(key: string): Promise<void>;

  // Conversation history
  getConversationHistory(): ConversationMessage[];
  async appendToHistory(message: ConversationMessage): Promise<void>;
  async clearHistory(): Promise<void>;

  // Checkpoints
  async saveCheckpoint(checkpoint: Checkpoint): Promise<void>;
  getCheckpoints(): Checkpoint[];
  async restoreCheckpoint(id: string): Promise<boolean>;
}
```

### ErrorHandler

Production-grade error handling with recovery strategies.

```typescript
import { ErrorHandler, ErrorSeverity } from './core/ErrorHandler';

class ErrorHandler {
  static getInstance(): ErrorHandler;

  async executeWithRecovery<T>(
    operation: () => Promise<T>,
    context: ErrorContext,
    strategy: RecoveryStrategyType
  ): Promise<T>;

  handleError(
    error: Error,
    severity: ErrorSeverity,
    context: ErrorContext
  ): void;

  registerRecoveryStrategy(
    name: string,
    strategy: RecoveryStrategy
  ): void;
}
```

### CacheManager

LRU cache with TTL and persistent storage.

```typescript
import { CacheManager, Memoize } from './core/CacheManager';

class CacheManager<T> {
  constructor(config?: Partial<CacheConfig>);

  set(key: string, value: T, ttl?: number): void;
  get(key: string): T | undefined;
  delete(key: string): boolean;
  clear(): void;
  keys(): string[];
  getStats(): CacheStats;
}

// Memoize decorator
@Memoize({ ttl: 60000 })
async expensiveOperation(): Promise<Result>;
```

---

## Provider APIs

### ProviderManager

Multi-provider AI model management (BYOM/BYOK).

```typescript
import { ProviderManager, AIProvider, ModelInfo } from './providers/ProviderManager';

class ProviderManager {
  static getInstance(): ProviderManager;

  // Provider management
  registerProvider(name: string, provider: AIProvider): void;
  getProvider(name?: string): AIProvider;
  getAvailableProviders(): string[];

  // Model management
  async getAvailableModels(providerName?: string): Promise<ModelInfo[]>;
  async switchModel(modelId: string, providerName?: string): Promise<void>;
  getCurrentModel(): string;

  // API keys
  async setApiKey(provider: string, key: string): Promise<void>;
  async getApiKey(provider: string): Promise<string | undefined>;

  // Streaming completion
  async streamCompletion(
    params: CompletionParams,
    onToken: (token: string) => void
  ): Promise<string>;
}

// Provider interface
interface AIProvider {
  name: string;
  streamCompletion(params: CompletionParams): AsyncIterable<string>;
  getAvailableModels(): Promise<ModelInfo[]>;
  validateApiKey(key: string): boolean;
}
```

---

## Agent APIs

### AgentOrchestrator

Multi-agent coordination and task delegation.

```typescript
import { AgentOrchestrator, Agent, AgentType } from './agents/AgentOrchestrator';

class AgentOrchestrator {
  static getInstance(): AgentOrchestrator;

  // Agent registration
  registerAgent(agent: Agent): void;
  unregisterAgent(name: string): void;
  getAgent(name: string): Agent | undefined;
  getActiveAgents(): Agent[];

  // Task execution
  async executeTask(
    task: Task,
    options?: TaskOptions
  ): Promise<TaskResult>;

  // Multi-agent collaboration
  async executeMultiAgent(
    task: Task,
    agentNames: string[]
  ): Promise<CollaborationResult>;

  // Critic review
  async reviewWithCritic(
    content: string,
    agentName: string
  ): Promise<ReviewResult>;
}

interface Agent {
  name: string;
  type: AgentType;
  systemPrompt: string;
  executeTask(task: Task): Promise<TaskResult>;
}
```

---

## Indexing APIs

### CodebaseIndex

Semantic codebase indexing with file watchers.

```typescript
import { CodebaseIndex, IndexedFile, SearchResult } from './indexing/CodebaseIndex';

class CodebaseIndex {
  static getInstance(): CodebaseIndex;

  // Indexing
  async indexWorkspace(): Promise<void>;
  async indexFile(filePath: string): Promise<void>;
  async removeFile(filePath: string): Promise<void>;

  // Search
  async search(query: string): Promise<SearchResult[]>;
  async semanticSearch(query: string, topK?: number): Promise<SearchResult[]>;

  // File watching
  startWatching(): void;
  stopWatching(): void;

  // Stats
  getStats(): IndexStats;
  isIndexing(): boolean;
}

interface IndexedFile {
  path: string;
  content: string;
  language: string;
  lastModified: number;
  embedding?: number[];
}
```

---

## UI APIs

### SynapsePanel

Main webview panel with chat interface.

```typescript
import { SynapsePanel } from './ui/SynapsePanel';

class SynapsePanel {
  static createOrShow(context: vscode.ExtensionContext): SynapsePanel;

  // Messaging
  postMessage(message: WebviewMessage): void;
  onDidReceiveMessage(handler: (message: any) => void): void;

  // Content updates
  updateChatHistory(messages: ChatMessage[]): void;
  appendStreamingMessage(content: string): void;
  showError(message: string): void;

  // Agent selection
  updateAgentList(agents: AgentInfo[]): void;
  setActiveAgent(agentName: string): void;

  // Visibility
  reveal(): void;
  dispose(): void;
}
```

---

## Utility APIs

### Helpers

Common utility functions.

```typescript
import {
  Debouncer,
  Throttler,
  estimateTokens,
  truncateText,
  generateId,
  formatDuration
} from './utils/helpers';

// Debouncing
const debouncer = new Debouncer(300);
debouncer.execute(() => doSomething());

// Throttling
const throttler = new Throttler(1000);
throttler.execute(() => doSomething());

// Token estimation
const tokens = estimateTokens('some text'); // => number

// Text utilities
const truncated = truncateText(longText, 1000);
const id = generateId();
const formatted = formatDuration(123456);
```

### Prompts

Pre-configured prompt templates.

```typescript
import {
  getPromptById,
  getPromptsByCategory,
  PromptTemplate
} from './prompts/templates';

const prompt = getPromptById('code_review');
const prompts = getPromptsByCategory('code_quality');

// Custom prompts
const custom: PromptTemplate = {
  id: 'custom_prompt',
  name: 'Custom Prompt',
  description: 'Does something custom',
  category: 'custom',
  systemPrompt: 'You are a helpful assistant...',
  userPromptTemplate: 'Please help with: {{input}}'
};
```

---

## Security APIs

### SecurityValidator

Input validation and sanitization.

```typescript
import { SecurityValidator, CommandAllowlist } from './security/SecurityValidator';

// Command validation
const result = SecurityValidator.validateCommand('rm -rf /');
// => { safe: false, reason: 'Command contains dangerous pattern' }

// Path validation
SecurityValidator.validatePath('/etc/passwd');

// URL validation
SecurityValidator.validateUrl('https://example.com');

// Sensitive data detection
SecurityValidator.containsSensitiveData(content);

// Command allowlist
CommandAllowlist.isAllowed('npm install');
CommandAllowlist.addAllowedCommand('custom-cmd');
```

---

## Monitoring APIs

### HealthMonitor

System health checks and graceful degradation.

```typescript
import { HealthMonitor, HealthStatus } from './core/HealthMonitor';

const monitor = HealthMonitor.getInstance();

// Health checks
const health = await monitor.checkAll();
// => { overall: 'healthy', checks: [...] }

// Start monitoring
monitor.startMonitoring(60000); // Check every minute

// Degradation management
DegradationManager.disableFeature('indexing', 'High memory usage');
DegradationManager.isFeatureAvailable('indexing');
```

### PerformanceProfiler

Performance profiling and optimization.

```typescript
import { PerformanceProfiler, ProfileMethod } from './core/PerformanceProfiler';

const profiler = PerformanceProfiler.getInstance();

// Profile an operation
const result = await profiler.profile('operation_name', async () => {
  return await doSomething();
});

// Decorator
class MyClass {
  @ProfileMethod('expensive_operation')
  async expensiveOperation() {
    // ...
  }
}

// Stats
const stats = profiler.getStats();
```

### MetricsCollector

Metrics collection and dashboards.

```typescript
import { MetricsCollector, Metrics } from './metrics/MetricsCollector';

const metrics = MetricsCollector.getInstance();

// Counters
metrics.counter(Metrics.API_REQUESTS, 1, { provider: 'openai' });

// Gauges
metrics.gauge('memory_usage', process.memoryUsage().heapUsed);

// Histograms
metrics.histogram(Metrics.API_DURATION, 250);

// Time an operation
await metrics.time('operation', async () => {
  return await doSomething();
});

// Dashboard
await metrics.showDashboard();
```

### Logger

Structured logging with levels.

```typescript
import { Logger, getComponentLogger, LogLevel } from './logging/Logger';

const logger = Logger.getInstance();
logger.setLevel(LogLevel.DEBUG);

// Basic logging
logger.info('Component', 'Something happened', { detail: 'value' });
logger.error('Component', 'Error occurred', { error: err.message });

// Component logger
const log = getComponentLogger('MyComponent');
log.info('Operation completed');
log.error('Operation failed', { error });
```

---

## Feature Flags

Gradual rollout and A/B testing.

```typescript
import { FeatureFlagManager, isFeatureEnabled, RequireFeature } from './core/FeatureFlags';

const flags = FeatureFlagManager.getInstance();
flags.initialize(stateManager, userId);

// Check feature
if (isFeatureEnabled('new_feature')) {
  // Use new feature
}

// Decorator
class MyService {
  @RequireFeature('experimental_feature')
  async experimentalMethod() {
    // Only runs if feature is enabled
  }
}

// Manage flags
await flags.setEnabled('feature_name', true);
await flags.setRolloutPercentage('feature_name', 50);
```

---

## Backup & Restore

Data protection and migration.

```typescript
import { BackupManager } from './backup/BackupManager';

const backup = new BackupManager(context, stateManager);

// Create backup
const backupId = await backup.createBackup();

// Restore
await backup.restoreBackup(backupId);

// Auto backup
backup.startAutoBackup(24); // Every 24 hours

// Export/Import
await backup.exportBackup(backupId);
const newId = await backup.importBackup();
```

---

## Circuit Breaker

Fault tolerance for external services.

```typescript
import { CircuitBreaker, providerCircuitBreaker } from './core/CircuitBreaker';

// Use predefined breaker
try {
  const result = await providerCircuitBreaker.execute(async () => {
    return await apiCall();
  });
} catch (error) {
  if (error instanceof CircuitBreakerError) {
    // Circuit is open
  }
}

// Custom breaker
const breaker = new CircuitBreaker('my-service', {
  failureThreshold: 5,
  resetTimeout: 30000
});
```

---

## Rate Limiter

Request throttling and abuse prevention.

```typescript
import { RateLimiter, apiRateLimiter } from './core/RateLimiter';

// Use predefined limiter
try {
  const result = await apiRateLimiter.execute('user-123', async () => {
    return await apiCall();
  });
} catch (error) {
  if (error instanceof RateLimitError) {
    // Rate limit exceeded
  }
}

// Custom limiter
const limiter = new RateLimiter({
  maxRequests: 60,
  windowMs: 60000,
  burstAllowance: 10
});
```

---

## Advanced Search

Regex, fuzzy, and semantic search.

```typescript
import { AdvancedSearch, advancedSearch } from './search/AdvancedSearch';

// Regex search
const results = await advancedSearch.searchWorkspace('pattern', {
  regex: true,
  caseSensitive: true
});

// Fuzzy search
const fuzzyResults = await advancedSearch.searchWorkspace('quik brown', {
  fuzzy: true
});

// Symbol search
const symbols = await advancedSearch.searchSymbols('functionName');

// Filter results
const filtered = advancedSearch.filterResults(results, {
  fileTypes: ['ts', 'js'],
  excludePaths: ['node_modules']
});
```

---

## Configuration

Validation and management.

```typescript
import { ConfigValidator, getConfigValidator } from './core/ConfigValidator';

const validator = getConfigValidator();

// Validate all settings
const result = validator.validateAll();
// => { valid: boolean, errors: [...], warnings: [...] }

// Auto-fix issues
await validator.autoFix();

// Reset to defaults
await validator.resetToDefaults();
```

---

## Events & Communication

```typescript
// VS Code commands
vscode.commands.registerCommand('synapse.openPanel', () => {
  SynapsePanel.createOrShow(context);
});

// Webview messaging
panel.postMessage({ type: 'chatResponse', content: 'Hello' });

// State change events
stateManager.onDidChange('conversationHistory', (newValue) => {
  // React to changes
});
```

---

## Type Definitions

### Common Types

```typescript
interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  agent?: string;
  metadata?: Record<string, any>;
}

interface Checkpoint {
  id: string;
  timestamp: number;
  files: string[];
  state: Record<string, any>;
  description: string;
}

interface Task {
  id: string;
  type: string;
  description: string;
  context?: Record<string, any>;
}

interface TaskResult {
  success: boolean;
  output?: string;
  error?: string;
  metadata?: Record<string, any>;
}

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  maxTokens: number;
  capabilities: string[];
}
```

---

## Error Handling

### Error Types

```typescript
class SynapseError extends Error {
  code: string;
  severity: ErrorSeverity;
  recoverable: boolean;
}

class CircuitBreakerError extends SynapseError {
  constructor(message: string);
}

class RateLimitError extends SynapseError {
  retryAfter: number;
}

class ConfigValidationError extends SynapseError {
  errors: ValidationError[];
}
```

---

## Best Practices

### 1. Error Handling
```typescript
try {
  const result = await operation();
} catch (error) {
  ErrorHandler.getInstance().handleError(
    error,
    ErrorSeverity.ERROR,
    { component: 'MyComponent', operation: 'myOperation' }
  );
}
```

### 2. Caching
```typescript
const cache = new CacheManager<Result>({ ttl: 300000 });

// Check cache first
let result = cache.get(key);
if (!result) {
  result = await fetchResult();
  cache.set(key, result);
}
```

### 3. Feature Flags
```typescript
if (isFeatureEnabled('new_feature')) {
  // Implement new behavior
} else {
  // Fallback to legacy behavior
}
```

### 4. Metrics
```typescript
const metrics = MetricsCollector.getInstance();

await metrics.time('operation', async () => {
  return await doOperation();
});
```

### 5. Logging
```typescript
const log = getComponentLogger('MyComponent');

log.info('Starting operation', { input: data });
log.error('Operation failed', { error: err.message });
```

---

## Support

For issues and feature requests, please refer to:
- GitHub Issues: https://github.com/your-org/synapse/issues
- Documentation: https://synapse-ai.dev/docs
- Community: https://discord.gg/synapse-ai

---

**License:** MIT  
**Copyright:** 2026 Synapse AI Team
