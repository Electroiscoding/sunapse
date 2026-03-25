import * as vscode from 'vscode';
import { SynapsePanel } from './ui/SynapsePanel';
import { CodebaseIndex } from './indexing/CodebaseIndex';
import { AgentOrchestrator } from './agents/AgentOrchestrator';
import { CleftEngine } from './cleft/CleftEngine';
import { ProviderManager } from './providers/ProviderManager';
import { StateManager } from './core/StateManager';
import { IterationEngine } from './core/IterationEngine';

// Production systems
import { ErrorHandler, ErrorSeverity } from './core/ErrorHandler';
import { HealthMonitor, DegradationManager } from './core/HealthMonitor';
import { FeatureFlagManager } from './core/FeatureFlags';
import { BackupManager } from './backup/BackupManager';
import { MigrationManager } from './migration/MigrationManager';
import { ConfigValidator, getConfigValidator } from './core/ConfigValidator';
import { PerformanceProfiler, MemoryLeakDetector } from './core/PerformanceProfiler';
import { MetricsCollector, Metrics } from './metrics/MetricsCollector';
import { Logger, getComponentLogger } from './logging/Logger';
import { providerCircuitBreaker, indexingCircuitBreaker } from './core/CircuitBreaker';
import { apiRateLimiter } from './core/RateLimiter';
import { CacheInvalidator } from './core/CacheInvalidator';
import { ConversationIO } from './io/ConversationIO';
import { getTelemetryReporter } from './telemetry/TelemetryReporter';

let panel: SynapsePanel | undefined;
let codebaseIndex: CodebaseIndex;
let agentOrchestrator: AgentOrchestrator;
let cleftEngine: CleftEngine;
let providerManager: ProviderManager;
let stateManager: StateManager;
let iterationEngine: IterationEngine;

// Production system instances
let healthMonitor: HealthMonitor;
let backupManager: BackupManager;
let migrationManager: MigrationManager;
let cacheInvalidator: CacheInvalidator;
let conversationIO: ConversationIO;
let memoryLeakDetector: MemoryLeakDetector;
let log: ReturnType<typeof getComponentLogger>;

export async function activate(context: vscode.ExtensionContext) {
    // Initialize logger first for early logging
    const logger = Logger.getInstance();
    log = getComponentLogger('Extension');
    log.info('Activating Synapse AI extension');

    try {
        // Run data migrations first
        stateManager = new StateManager(context);
        migrationManager = new MigrationManager(stateManager);
        const migrationResult = await migrationManager.migrate();
        if (!migrationResult.success) {
            log.error('Migration failed', { errors: migrationResult.migrated });
        }

        // Validate configuration
        const configValidator = getConfigValidator();
        const validation = configValidator.validateAll();
        if (!validation.valid) {
            log.warn('Configuration validation failed', { errors: validation.errors });
            vscode.window.showWarningMessage(
                'Synapse: Configuration issues detected. Run "Synapse: Validate Configuration" for details.'
            );
        }

        // Initialize feature flags
        const featureFlags = FeatureFlagManager.getInstance();
        featureFlags.initialize(stateManager, context.globalStorageUri.toString());

        // Initialize health monitoring
        healthMonitor = HealthMonitor.getInstance();
        healthMonitor.startMonitoring(60000);

        // Initialize metrics
        const metrics = MetricsCollector.getInstance();
        metrics.startReporting(300000);

        // Initialize backup manager
        backupManager = new BackupManager(context, stateManager);
        backupManager.startAutoBackup(24);

        // Initialize core components
        providerManager = new ProviderManager(stateManager);
        codebaseIndex = new CodebaseIndex(context, stateManager);
        agentOrchestrator = new AgentOrchestrator(providerManager, stateManager);
        cleftEngine = new CleftEngine(context, stateManager);
        iterationEngine = new IterationEngine(agentOrchestrator, stateManager, cleftEngine);

        // Initialize cache invalidation
        cacheInvalidator = new CacheInvalidator(
            require('./core/CacheManager').fileCache,
            stateManager
        );
        cacheInvalidator.watchWorkspace();

        // Initialize conversation I/O
        conversationIO = new ConversationIO(stateManager);

        // Initialize memory leak detection
        memoryLeakDetector = new MemoryLeakDetector();
        memoryLeakDetector.startMonitoring(30000);

        // Register all commands
        registerCommands(context);

        // Auto-index on startup with circuit breaker protection
        const config = vscode.workspace.getConfiguration('synapse');
        if (config.get<boolean>('indexing.enabled')) {
            setTimeout(async () => {
                try {
                    await indexingCircuitBreaker.execute(async () => {
                        await metrics.time('startup_index', async () => {
                            await codebaseIndex.indexWorkspace();
                        });
                    });
                    log.info('Auto-indexing completed');
                } catch (error) {
                    log.error('Auto-indexing failed', { error: (error as Error).message });
                    DegradationManager.disableFeature('indexing', 'Startup indexing failed');
                }
            }, 5000);
        }

        // Set context as enabled
        vscode.commands.executeCommand('setContext', 'synapse:enabled', true);

        // Restore iteration if it was running
        if (stateManager.get<boolean>('iterationActive', false)) {
            try {
                await iterationEngine.restore();
                log.info('Iteration engine restored');
            } catch (error) {
                log.error('Failed to restore iteration', { error: (error as Error).message });
            }
        }

        // Log activation success
        metrics.counter('extension_activations', 1);
        log.info('Synapse AI extension activated successfully');

    } catch (error) {
        const errorHandler = ErrorHandler.getInstance();
        errorHandler.logError(
            error as Error,
            { component: 'Extension', operation: 'activate' },
            0
        );
        throw error;
    }
}

export function deactivate() {
    log?.info('Deactivating Synapse AI extension');

    // Stop all monitoring
    healthMonitor?.stopMonitoring();
    backupManager?.stopAutoBackup();
    memoryLeakDetector?.stopMonitoring();
    MetricsCollector.getInstance().stopReporting();

    // Dispose all resources
    panel?.dispose();
    cleftEngine?.dispose();
    iterationEngine?.dispose();
    codebaseIndex?.dispose();
    cacheInvalidator?.dispose();
    Logger.getInstance().dispose();
    healthMonitor?.dispose();
    backupManager?.dispose();

    log?.info('Synapse AI extension deactivated');
}

function registerCommands(context: vscode.ExtensionContext): void {
    const commands = [
        vscode.commands.registerCommand('synapse.openPanel', async () => {
            await executeWithMonitoring('openPanel', async () => {
                if (panel) {
                    panel.reveal();
                } else {
                    panel = new SynapsePanel(
                        context,
                        providerManager,
                        agentOrchestrator,
                        codebaseIndex,
                        cleftEngine,
                        stateManager,
                        iterationEngine
                    );
                    panel.onDispose(() => {
                        panel = undefined;
                    });
                }
            });
        }),

        vscode.commands.registerCommand('synapse.indexCodebase', async () => {
            await executeWithMonitoring('indexCodebase', async () => {
                await apiRateLimiter.execute('index', async () => {
                    await indexingCircuitBreaker.execute(async () => {
                        await codebaseIndex.indexWorkspace();
                        vscode.window.showInformationMessage('Synapse: Codebase indexing complete');
                    });
                });
            });
        }),

        vscode.commands.registerCommand('synapse.clearIndex', async () => {
            await executeWithMonitoring('clearIndex', async () => {
                await codebaseIndex.clearIndex();
                cacheInvalidator.invalidateAll();
                vscode.window.showInformationMessage('Synapse: Index cleared');
            });
        }),

        vscode.commands.registerCommand('synapse.startCleft', async () => {
            await executeWithMonitoring('startCleft', async () => {
                await cleftEngine.start();
                vscode.window.showInformationMessage('Synapse: Cleft autonomous flow started');
            });
        }),

        vscode.commands.registerCommand('synapse.stopCleft', async () => {
            await executeWithMonitoring('stopCleft', async () => {
                await cleftEngine.stop();
                vscode.window.showInformationMessage('Synapse: Cleft flow stopped');
            });
        }),

        vscode.commands.registerCommand('synapse.switchModel', async () => {
            await executeWithMonitoring('switchModel', async () => {
                await providerManager.switchModel();
            });
        }),

        vscode.commands.registerCommand('synapse.addCustomAgent', async () => {
            await executeWithMonitoring('addCustomAgent', async () => {
                await agentOrchestrator.addCustomAgent();
            });
        }),

        // Health & Status
        vscode.commands.registerCommand('synapse.showHealth', async () => {
            await healthMonitor.showHealthStatus();
        }),

        vscode.commands.registerCommand('synapse.showMetrics', async () => {
            await MetricsCollector.getInstance().showDashboard();
        }),

        vscode.commands.registerCommand('synapse.showLogs', () => {
            Logger.getInstance().show();
        }),

        // Configuration
        vscode.commands.registerCommand('synapse.validateConfig', async () => {
            const validator = getConfigValidator();
            await validator.showValidationResults();
        })
    ];

    context.subscriptions.push(...commands);
}

async function executeWithMonitoring<T>(
    commandName: string,
    fn: () => Promise<T>
): Promise<T | undefined> {
    const metrics = MetricsCollector.getInstance();
    const profiler = PerformanceProfiler.getInstance();

    try {
        metrics.counter(Metrics.UI_INTERACTIONS, 1, { command: commandName });
        return await profiler.profile(`command_${commandName}`, fn);
    } catch (error) {
        metrics.counter('command_errors', 1, { command: commandName });
        throw error;
    }
}
