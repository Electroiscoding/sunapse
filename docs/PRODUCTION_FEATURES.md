# Synapse Production Features

This document describes the production-grade features implemented in Synapse AI extension.

## Table of Contents

1. [Error Handling & Recovery](#error-handling--recovery)
2. [Rate Limiting](#rate-limiting)
3. [Circuit Breakers](#circuit-breakers)
4. [Caching](#caching)
5. [Security](#security)
6. [Health Monitoring](#health-monitoring)
7. [Configuration Validation](#configuration-validation)
8. [Performance Profiling](#performance-profiling)
9. [Feature Flags](#feature-flags)
10. [Backup & Restore](#backup--restore)
11. [Data Migration](#data-migration)
12. [Cache Invalidation](#cache-invalidation)
13. [Advanced Search](#advanced-search)
14. [Logging](#logging)
15. [Metrics & Dashboards](#metrics--dashboards)
16. [Conversation I/O](#conversation-io)

---

## Error Handling & Recovery

**Location**: `src/core/ErrorHandler.ts`

Comprehensive error handling with severity levels and recovery strategies:

- **Severity Levels**: LOW, MEDIUM, HIGH, CRITICAL, FATAL
- **Recovery Strategies**: retry, fallback, circuit-breaker, queue
- **Error Context**: component, operation, userId, metadata
- **Automatic Retry**: Exponential backoff with jitter
- **Queue Management**: Failed operations queued for retry

**Usage**:
```typescript
const errorHandler = ErrorHandler.getInstance();

await errorHandler.executeWithRecovery(
  async () => await apiCall(),
  { component: 'API', operation: 'fetch' },
  'retry'
);
```

---

## Rate Limiting

**Location**: `src/core/RateLimiter.ts`

Token bucket rate limiting with burst allowance:

- **Per-User Tracking**: Separate limits per user
- **Burst Allowance**: Handle traffic spikes
- **Configurable Windows**: Custom time windows
- **Pre-Execution Check**: Prevent operations if limited

**Usage**:
```typescript
const limiter = new RateLimiter({
  maxRequests: 50,
  windowMs: 60000,
  burstAllowance: 10
});

await limiter.execute('user-123', async () => await operation());
```

---

## Circuit Breakers

**Location**: `src/core/CircuitBreaker.ts`

Fault tolerance pattern preventing cascade failures:

- **States**: CLOSED, OPEN, HALF_OPEN
- **Automatic Recovery**: Resets after timeout
- **Success Tracking**: Recovers on success threshold
- **Predefined Breakers**: apiCircuitBreaker, indexingCircuitBreaker

**Usage**:
```typescript
import { providerCircuitBreaker } from './core/CircuitBreaker';

await providerCircuitBreaker.execute(async () => await apiCall());
```

---

## Caching

**Location**: `src/core/CacheManager.ts`

Production-grade caching with TTL and LRU eviction:

- **TTL Support**: Per-entry time-to-live
- **LRU Eviction**: Removes least recently used
- **Size Limits**: Configurable maximum entries
- **Persistent Storage**: Saves to disk
- **Memoize Decorator**: Automatic method caching

**Usage**:
```typescript
const cache = new CacheManager<Result>({ maxSize: 1000, defaultTTL: 300000 });
cache.set('key', value);
const result = cache.get('key');

// Decorator
@Memoize({ ttl: 60000 })
async expensiveOperation() { }
```

---

## Security

**Location**: `src/security/SecurityValidator.ts`

Comprehensive security validation:

- **Command Allowlisting**: Only allowed commands execute
- **Path Validation**: Prevent path traversal
- **URL Validation**: Block malicious URLs
- **Sensitive Data Detection**: Find API keys, passwords
- **Prompt Injection Detection**: Block injection attempts

**Usage**:
```typescript
import { SecurityValidator } from './security/SecurityValidator';

SecurityValidator.validateCommand('npm install');
SecurityValidator.validatePath('/etc/passwd');
```

---

## Health Monitoring

**Location**: `src/core/HealthMonitor.ts`

System health checks and graceful degradation:

- **Periodic Checks**: Memory, API connectivity, indexing
- **Health Dashboard**: Visual status overview
- **Graceful Degradation**: Disable features under stress
- **Automatic Recovery**: Re-enable when healthy

**Commands**:
- `Synapse: Show Health Status`
- `Synapse: Show Metrics Dashboard`

---

## Configuration Validation

**Location**: `src/core/ConfigValidator.ts`

Schema-based configuration validation:

- **Type Checking**: Validates all settings
- **Pattern Matching**: Regex validation
- **Range Validation**: Min/max bounds
- **Auto-Fix**: Correct common issues
- **UI Reporting**: Show validation results

**Commands**:
- `Synapse: Validate Configuration`

---

## Performance Profiling

**Location**: `src/core/PerformanceProfiler.ts`

Execution time and memory tracking:

- **Method Profiling**: Track any function
- **Memory Monitoring**: Heap usage tracking
- **Statistical Analysis**: P50, P95, P99 latencies
- **Decorator Support**: `@ProfileMethod()`
- **Memory Leak Detection**: Automatic leak alerts

**Usage**:
```typescript
@ProfileMethod('operation_name')
async myMethod() { }

// Or manual
await profiler.profile('name', async () => await operation());
```

**Commands**:
- `Synapse: Show Performance Report`

---

## Feature Flags

**Location**: `src/core/FeatureFlags.ts`

Gradual rollout and A/B testing:

- **Enable/Disable**: Per-feature control
- **Rollout Percentage**: Gradual releases
- **User Targeting**: User-specific flags
- **Kill Switch**: Emergency disable all
- **Dependency Checking**: Require other flags

**Usage**:
```typescript
import { isFeatureEnabled } from './core/FeatureFlags';

if (isFeatureEnabled('new_feature')) {
  // New behavior
}

@RequireFeature('experimental')
async experimentalMethod() { }
```

**Commands**:
- `Synapse: Show Feature Flags`
- `Synapse: Emergency Kill Switch`

---

## Backup & Restore

**Location**: `src/backup/BackupManager.ts`

Automated data protection:

- **Auto-Backup**: Daily scheduled backups
- **Manual Backup**: On-demand creation
- **Selective Restore**: Choose what to restore
- **Export/Import**: Share backups
- **Auto-Cleanup**: Remove old backups

**Commands**:
- `Synapse: Create Backup`
- `Synapse: Restore Backup`

---

## Data Migration

**Location**: `src/migration/MigrationManager.ts`

Schema evolution across versions:

- **Version Tracking**: Current schema version
- **Migration Chain**: Sequential migrations
- **Rollback Support**: Reverse migrations
- **Data Integrity**: Checksums and validation

**Automatic**: Runs on extension activation

---

## Cache Invalidation

**Location**: `src/core/CacheInvalidator.ts`

Intelligent cache management:

- **File Watching**: Auto-invalidate on changes
- **Pattern Matching**: Invalidation rules
- **Smart Invalidation**: Related cache clearing
- **Bulk Operations**: Clear all caches

**Automatic**: Watches workspace files

---

## Advanced Search

**Location**: `src/search/AdvancedSearch.ts`

Powerful workspace search:

- **Regex Support**: Pattern matching
- **Fuzzy Matching**: Approximate search
- **File Filters**: Include/exclude patterns
- **Symbol Search**: Find functions/classes
- **Quick Pick UI**: Interactive results

**Commands**:
- `Synapse: Advanced Search` (when implemented)

---

## Logging

**Location**: `src/logging/Logger.ts`

Structured logging infrastructure:

- **Log Levels**: DEBUG, INFO, WARN, ERROR, FATAL
- **Component Logging**: Per-component loggers
- **Log Buffering**: In-memory buffer
- **Export**: Save logs to file
- **Output Channel**: VS Code integration

**Usage**:
```typescript
import { getComponentLogger } from './logging/Logger';

const log = getComponentLogger('MyComponent');
log.info('Operation completed', { detail: 'value' });
```

**Commands**:
- `Synapse: Show Logs`

---

## Metrics & Dashboards

**Location**: `src/metrics/MetricsCollector.ts`

Production monitoring with counters, gauges, histograms:

- **Counters**: Event counting
- **Gauges**: Point-in-time values
- **Histograms**: Distribution tracking
- **Auto-Reporting**: Periodic submission
- **Dashboard View**: Visual metrics display
- **Labels/Dimensions**: Categorized metrics

**Usage**:
```typescript
const metrics = MetricsCollector.getInstance();

metrics.counter('api_calls', 1, { provider: 'openai' });
metrics.gauge('memory', process.memoryUsage().heapUsed);
metrics.histogram('latency', 250);
```

**Commands**:
- `Synapse: Show Metrics Dashboard`

---

## Conversation I/O

**Location**: `src/io/ConversationIO.ts`

Import/export conversation history:

- **JSON Export**: Structured data export
- **Markdown Export**: Human-readable format
- **Batch Import**: Restore conversations
- **Search**: Find within conversations
- **Archive**: Move old conversations

**Commands**:
- `Synapse: Export Conversations`
- `Synapse: Import Conversations`
- `Synapse: Clear Conversations`

---

## Configuration

All production features are configurable via VS Code settings:

```json
{
  "synapse.backup.enabled": true,
  "synapse.backup.maxBackups": 10,
  "synapse.cache.enabled": true,
  "synapse.cache.maxSize": 1000,
  "synapse.cache.defaultTTL": 300,
  "synapse.logLevel": "info",
  "synapse.healthCheck.enabled": true,
  "synapse.rateLimit.api.maxRequests": 50,
  "synapse.featureFlags.showIndicator": true
}
```

---

## Monitoring Commands

| Command | Description |
|---------|-------------|
| `Synapse: Show Health Status` | View system health |
| `Synapse: Show Metrics Dashboard` | View performance metrics |
| `Synapse: Show Logs` | Open log output |
| `Synapse: Show Performance Report` | View profiling results |
| `Synapse: Show Feature Flags` | View feature status |
| `Synapse: Validate Configuration` | Check config validity |
| `Synapse: Emergency Kill Switch` | Disable all features |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Synapse Extension                     │
├─────────────────────────────────────────────────────────┤
│  UI Layer (SynapsePanel, Webviews)                      │
├─────────────────────────────────────────────────────────┤
│  Agent Layer (AgentOrchestrator, CleftEngine)          │
├─────────────────────────────────────────────────────────┤
│  Core Systems (Providers, Indexing, State)              │
├─────────────────────────────────────────────────────────┤
│  Production Layer                                       │
│  ├── ErrorHandler (Recovery, Retry)                     │
│  ├── CircuitBreaker (Fault tolerance)                   │
│  ├── RateLimiter (Throttling)                           │
│  ├── CacheManager (Performance)                         │
│  ├── HealthMonitor (Status checks)                    │
│  ├── FeatureFlags (Rollouts)                            │
│  ├── BackupManager (Data protection)                    │
│  ├── Logger (Observability)                             │
│  └── MetricsCollector (Monitoring)                      │
├─────────────────────────────────────────────────────────┤
│  Security Layer (SecurityValidator)                     │
└─────────────────────────────────────────────────────────┘
```

---

## API Reference

See [API_REFERENCE.md](./API_REFERENCE.md) for detailed API documentation.

---

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for production deployment guide.

---

## Support

For issues and questions:
- GitHub Issues: https://github.com/your-org/synapse/issues
- Documentation: https://synapse-ai.dev/docs
