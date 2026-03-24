# Synapse Production Deployment Guide

## Prerequisites

- Node.js 18+ 
- VS Code 1.85+
- Git
- npm or yarn

## Installation

```bash
# Clone the repository
git clone https://github.com/your-org/synapse.git
cd synapse

# Install dependencies
npm install

# Verify installation
npm run verify
```

## Build Process

### Development Build
```bash
npm run compile
```

### Production Build
```bash
npm run build:production
```

### Package Extension
```bash
npx vsce package
```

## Configuration

### Environment Variables
Create `.env` file:
```
SYNAPSE_ENV=production
SYNAPSE_LOG_LEVEL=info
SYNAPSE_TELEMETRY_ENABLED=true
SYNAPSE_HEALTH_CHECK_INTERVAL=60000
```

### VS Code Settings
```json
{
  "synapse.provider": "openrouter",
  "synapse.model": "anthropic/claude-3.5-sonnet",
  "synapse.telemetry.enabled": true,
  "synapse.indexing.enabled": true,
  "synapse.cleft.enabled": false,
  "synapse.agents.activeAgents": ["coder", "orchestrator"]
}
```

## Production Checklist

### Pre-Deployment
- [ ] All tests passing (`npm test`)
- [ ] Linting clean (`npm run lint`)
- [ ] Type checking passed (`npm run typecheck`)
- [ ] Build successful (`npm run compile`)
- [ ] Security audit passed (`npm audit`)
- [ ] Version bumped in package.json
- [ ] CHANGELOG.md updated

### Deployment Steps
1. **Create Release Branch**
   ```bash
   git checkout -b release/v1.0.0
   ```

2. **Update Version**
   ```bash
   npm version 1.0.0
   ```

3. **Build & Test**
   ```bash
   npm run ci
   ```

4. **Package Extension**
   ```bash
   npx vsce package --no-yarn
   ```

5. **Publish to Marketplace**
   ```bash
   npx vsce publish
   ```

### Post-Deployment
- [ ] Verify extension installs correctly
- [ ] Test core features
- [ ] Monitor error telemetry
- [ ] Check performance metrics
- [ ] Verify backup system

## Monitoring & Observability

### Health Checks
- Extension activates successfully
- Health status dashboard accessible
- All feature flags initialized
- Circuit breakers functional

### Metrics to Watch
- API response times (p50, p95, p99)
- Error rates by component
- Memory usage trends
- Indexing completion times
- User engagement metrics

### Alerts
Configure alerts for:
- Error rate > 5%
- Memory usage > 500MB
- API response time > 5s (p95)
- Circuit breaker trips
- Backup failures

## Performance Tuning

### Caching Strategy
```typescript
// Default cache configuration
const cacheConfig = {
  maxSize: 1000,
  defaultTTL: 300000,  // 5 minutes
  checkInterval: 60000   // 1 minute
};
```

### Rate Limiting
```typescript
// Default limits
const rateLimits = {
  api: { maxRequests: 50, windowMs: 60000 },
  indexing: { maxRequests: 10, windowMs: 60000 },
  terminal: { maxRequests: 20, windowMs: 60000 }
};
```

### Circuit Breaker Settings
```typescript
// Default breaker configuration
const breakerConfig = {
  failureThreshold: 5,
  successThreshold: 3,
  resetTimeout: 30000
};
```

## Security Considerations

### API Key Storage
- Keys stored in VS Code SecretStorage
- Never logged or exposed in UI
- Rotated on provider switch

### Command Validation
- All terminal commands validated against allowlist
- Dangerous patterns blocked automatically
- User confirmation required for unknown commands

### Input Sanitization
- All user input sanitized before processing
- HTML/script injection prevented
- Path traversal blocked

### Data Protection
- Conversations encrypted at rest
- Backups compressed and encrypted
- No data sent to external analytics

## Troubleshooting

### Common Issues

**Extension fails to activate**
```bash
# Check logs
Command Palette → "Synapse: Show Logs"

# Verify configuration
Command Palette → "Synapse: Validate Configuration"

# Reset to defaults
Command Palette → "Developer: Reload Window"
```

**High memory usage**
```bash
# Clear caches
Command Palette → "Synapse: Clear Index"

# Reduce cache size in settings
"synapse.cache.maxSize": 500
```

**Slow indexing**
```bash
# Exclude large directories
"synapse.indexing.excludePatterns": [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**"
]
```

**API rate limiting**
```bash
# Check rate limit status
Command Palette → "Synapse: Show Metrics"

# Increase intervals between requests
"synapse.rateLimit.windowMs": 120000
```

### Debug Mode
Enable debug logging:
```json
{
  "synapse.telemetry.debug": true,
  "synapse.logLevel": "debug"
}
```

### Emergency Procedures

**Kill Switch**
If critical issues arise:
```bash
Command Palette → "Synapse: Emergency Kill Switch"
```
This disables all features immediately.

**Restore from Backup**
```bash
Command Palette → "Synapse: Restore Backup"
```

## Rollback Plan

1. **Immediate Rollback**
   ```bash
   # Uninstall current version
   code --uninstall-extension your-org.synapse
   
   # Install previous version
   code --install-extension synapse-0.9.0.vsix
   ```

2. **Data Recovery**
   - Restore from latest backup
   - Reset configuration to defaults
   - Clear corrupted caches

3. **Communication**
   - Post incident report
   - Notify users via release notes
   - Update status page

## Support

- **Documentation**: https://synapse-ai.dev/docs
- **Issues**: https://github.com/your-org/synapse/issues
- **Email**: support@synapse-ai.dev

---

**Last Updated**: March 2026  
**Version**: 1.0.0
