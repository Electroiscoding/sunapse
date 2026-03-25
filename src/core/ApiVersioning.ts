import { getComponentLogger } from '../logging/Logger';
import { MetricsCollector } from '../metrics/MetricsCollector';

/**
 * ApiVersioning - Production-grade API versioning and backwards compatibility
 * 
 * Features:
 * - Semantic versioning support
 * - Version negotiation
 * - Deprecation warnings
 * - Migration helpers
 * - Backwards compatibility layers
 * - Version routing
 */

export type ApiVersion = '1.0' | '2.0' | '3.0';

export interface VersionedRequest {
    version?: ApiVersion;
    endpoint: string;
    method: string;
    headers?: Record<string, string>;
    body?: any;
}

export interface VersionedResponse<T = any> {
    version: ApiVersion;
    status: number;
    data: T;
    deprecated?: boolean;
    deprecationDate?: string;
    alternatives?: string[];
}

export interface ApiMigration {
    fromVersion: ApiVersion;
    toVersion: ApiVersion;
    transformRequest?: (req: any) => any;
    transformResponse?: (res: any) => any;
    breakingChanges: string[];
}

export interface EndpointDefinition {
    path: string;
    method: string;
    versions: ApiVersion[];
    currentVersion: ApiVersion;
    deprecatedVersions: ApiVersion[];
    minSupportedVersion: ApiVersion;
}

export class ApiVersionManager {
    private currentVersion: ApiVersion = '2.0';
    private supportedVersions: ApiVersion[] = ['1.0', '2.0'];
    private deprecatedVersions: ApiVersion[] = ['1.0'];
    private migrations: Map<string, ApiMigration> = new Map();
    private endpoints: Map<string, EndpointDefinition> = new Map();
    private log = getComponentLogger('ApiVersionManager');
    private metrics = MetricsCollector.getInstance();

    constructor() {
        this.registerDefaultMigrations();
        this.registerDefaultEndpoints();
    }

    /**
     * Get current API version
     */
    getCurrentVersion(): ApiVersion {
        return this.currentVersion;
    }

    /**
     * Get supported versions
     */
    getSupportedVersions(): ApiVersion[] {
        return [...this.supportedVersions];
    }

    /**
     * Check if version is supported
     */
    isVersionSupported(version: ApiVersion): boolean {
        return this.supportedVersions.includes(version);
    }

    /**
     * Check if version is deprecated
     */
    isVersionDeprecated(version: ApiVersion): boolean {
        return this.deprecatedVersions.includes(version);
    }

    /**
     * Negotiate API version from request
     */
    negotiateVersion(requestedVersion?: string): ApiVersion {
        // Default to current version
        if (!requestedVersion) {
            return this.currentVersion;
        }

        // Check if requested version is supported
        if (this.isVersionSupported(requestedVersion as ApiVersion)) {
            return requestedVersion as ApiVersion;
        }

        // Fall back to minimum supported version
        const minVersion = this.supportedVersions[0];
        this.log.warn(`Version ${requestedVersion} not supported, falling back to ${minVersion}`);
        
        this.metrics.counter('api_version_fallback', 1, { 
            from: requestedVersion, 
            to: minVersion 
        });

        return minVersion;
    }

    /**
     * Register API endpoint
     */
    registerEndpoint(definition: EndpointDefinition): void {
        const key = `${definition.method}:${definition.path}`;
        this.endpoints.set(key, definition);
        this.log.info(`Registered endpoint ${key} supporting versions: ${definition.versions.join(', ')}`);
    }

    /**
     * Get endpoint definition
     */
    getEndpoint(method: string, path: string): EndpointDefinition | undefined {
        return this.endpoints.get(`${method}:${path}`);
    }

    /**
     * Register version migration
     */
    registerMigration(migration: ApiMigration): void {
        const key = `${migration.fromVersion}->${migration.toVersion}`;
        this.migrations.set(key, migration);
        this.log.info(`Registered migration ${key}`);
    }

    /**
     * Transform request for version compatibility
     */
    transformRequest<T>(
        request: T,
        fromVersion: ApiVersion,
        toVersion: ApiVersion
    ): T {
        if (fromVersion === toVersion) {
            return request;
        }

        const migration = this.findMigration(fromVersion, toVersion);
        if (migration?.transformRequest) {
            this.metrics.counter('api_request_transformed', 1, { 
                from: fromVersion, 
                to: toVersion 
            });
            return migration.transformRequest(request);
        }

        return request;
    }

    /**
     * Transform response for version compatibility
     */
    transformResponse<T>(
        response: T,
        fromVersion: ApiVersion,
        toVersion: ApiVersion
    ): VersionedResponse<T> {
        let data = response;

        if (fromVersion !== toVersion) {
            const migration = this.findMigration(fromVersion, toVersion);
            if (migration?.transformResponse) {
                data = migration.transformResponse(response);
            }
        }

        const versionedResponse: VersionedResponse<T> = {
            version: toVersion,
            status: 200,
            data
        };

        // Add deprecation info if applicable
        if (this.isVersionDeprecated(toVersion)) {
            versionedResponse.deprecated = true;
            versionedResponse.deprecationDate = this.getDeprecationDate(toVersion);
            versionedResponse.alternatives = [`Migrate to API version ${this.currentVersion}`];
        }

        return versionedResponse;
    }

    /**
     * Validate request against endpoint version
     */
    validateRequest(
        endpoint: EndpointDefinition,
        requestedVersion: ApiVersion
    ): { valid: boolean; error?: string } {
        if (!endpoint.versions.includes(requestedVersion)) {
            return {
                valid: false,
                error: `Version ${requestedVersion} not supported for ${endpoint.method} ${endpoint.path}. ` +
                       `Supported versions: ${endpoint.versions.join(', ')}`
            };
        }

        if (endpoint.deprecatedVersions.includes(requestedVersion)) {
            this.log.warn(`Deprecated version ${requestedVersion} used for ${endpoint.method} ${endpoint.path}`);
            this.metrics.counter('api_deprecated_version_usage', 1, {
                endpoint: endpoint.path,
                version: requestedVersion
            });
        }

        return { valid: true };
    }

    /**
     * Get version info for response headers
     */
    getVersionHeaders(version: ApiVersion): Record<string, string> {
        const headers: Record<string, string> = {
            'X-API-Version': version,
            'X-API-Current-Version': this.currentVersion
        };

        if (this.isVersionDeprecated(version)) {
            headers['Deprecation'] = `true; sunset="${this.getDeprecationDate(version)}"`;
            headers['Sunset'] = this.getDeprecationDate(version);
        }

        return headers;
    }

    /**
     * Create backwards compatibility wrapper
     */
    createCompatibilityWrapper<T extends (...args: any[]) => any>(
        fn: T,
        version: ApiVersion
    ): T {
        return ((...args: any[]) => {
            this.log.warn(`Using deprecated API version ${version}`);
            this.metrics.counter('api_deprecated_usage', 1, { version });
            return fn(...args);
        }) as T;
    }

    /**
     * Generate migration guide
     */
    generateMigrationGuide(fromVersion: ApiVersion, toVersion: ApiVersion): string {
        const migration = this.findMigration(fromVersion, toVersion);
        
        if (!migration) {
            return `No migration guide available for ${fromVersion} -> ${toVersion}`;
        }

        let guide = `# API Migration Guide: ${fromVersion} -> ${toVersion}\n\n`;
        
        guide += `## Breaking Changes\n\n`;
        migration.breakingChanges.forEach((change, i) => {
            guide += `${i + 1}. ${change}\n`;
        });

        if (migration.transformRequest) {
            guide += `\n## Request Transformation Required\n`;
            guide += `Requests must be transformed when migrating.\n`;
        }

        if (migration.transformResponse) {
            guide += `\n## Response Transformation Required\n`;
            guide += `Responses will be transformed for backwards compatibility.\n`;
        }

        return guide;
    }

    /**
     * Get API compatibility report
     */
    getCompatibilityReport(): {
        currentVersion: ApiVersion;
        supportedVersions: ApiVersion[];
        deprecatedVersions: ApiVersion[];
        endpoints: Array<{
            path: string;
            method: string;
            versions: ApiVersion[];
            deprecated: ApiVersion[];
        }>;
    } {
        const endpointList = Array.from(this.endpoints.values()).map(e => ({
            path: e.path,
            method: e.method,
            versions: e.versions,
            deprecated: e.deprecatedVersions
        }));

        return {
            currentVersion: this.currentVersion,
            supportedVersions: this.supportedVersions,
            deprecatedVersions: this.deprecatedVersions,
            endpoints: endpointList
        };
    }

    private findMigration(
        fromVersion: ApiVersion,
        toVersion: ApiVersion
    ): ApiMigration | undefined {
        // Direct migration
        const directKey = `${fromVersion}->${toVersion}`;
        if (this.migrations.has(directKey)) {
            return this.migrations.get(directKey);
        }

        // Chain migrations if needed
        for (const version of this.supportedVersions) {
            const step1 = this.migrations.get(`${fromVersion}->${version}`);
            const step2 = this.migrations.get(`${version}->${toVersion}`);
            
            if (step1 && step2) {
                return {
                    fromVersion,
                    toVersion,
                    breakingChanges: [...step1.breakingChanges, ...step2.breakingChanges],
                    transformRequest: (req) => {
                        if (step2.transformRequest && step1.transformRequest) {
                            return step2.transformRequest(step1.transformRequest(req));
                        }
                        return step2.transformRequest?.(req) ?? step1.transformRequest?.(req) ?? req;
                    },
                    transformResponse: (res) => {
                        if (step2.transformResponse && step1.transformResponse) {
                            return step1.transformResponse(step2.transformResponse(res));
                        }
                        return step1.transformResponse?.(res) ?? step2.transformResponse?.(res) ?? res;
                    }
                };
            }
        }

        return undefined;
    }

    private getDeprecationDate(version: ApiVersion): string {
        // In production, these would be actual planned deprecation dates
        const dates: Record<ApiVersion, string> = {
            '1.0': '2025-06-01',
            '2.0': '', // Current version, not deprecated
            '3.0': ''  // Future version
        };
        return dates[version] || '2025-12-31';
    }

    private registerDefaultMigrations(): void {
        // Migration from 1.0 to 2.0
        this.registerMigration({
            fromVersion: '1.0',
            toVersion: '2.0',
            breakingChanges: [
                'Response format changed from nested to flat',
                'Error codes updated to follow RFC 7807',
                'Pagination parameters changed from offset/limit to cursor-based'
            ],
            transformRequest: (req) => {
                // Transform old pagination to new cursor format
                if (req.offset !== undefined && req.limit !== undefined) {
                    return {
                        ...req,
                        cursor: req.offset ? btoa(`offset:${req.offset}`) : undefined,
                        pageSize: req.limit
                    };
                }
                return req;
            },
            transformResponse: (res) => {
                // Transform new response to old format
                if (res.items && Array.isArray(res.items)) {
                    return {
                        data: res.items,
                        total: res.totalCount,
                        hasMore: res.hasNextPage
                    };
                }
                return res;
            }
        });
    }

    private registerDefaultEndpoints(): void {
        // Conversation endpoints
        this.registerEndpoint({
            path: '/conversations',
            method: 'GET',
            versions: ['1.0', '2.0'],
            currentVersion: '2.0',
            deprecatedVersions: ['1.0'],
            minSupportedVersion: '1.0'
        });

        this.registerEndpoint({
            path: '/conversations',
            method: 'POST',
            versions: ['1.0', '2.0'],
            currentVersion: '2.0',
            deprecatedVersions: ['1.0'],
            minSupportedVersion: '1.0'
        });

        // Agent endpoints
        this.registerEndpoint({
            path: '/agents',
            method: 'GET',
            versions: ['2.0'],
            currentVersion: '2.0',
            deprecatedVersions: [],
            minSupportedVersion: '2.0'
        });

        // Indexing endpoints
        this.registerEndpoint({
            path: '/index',
            method: 'POST',
            versions: ['1.0', '2.0'],
            currentVersion: '2.0',
            deprecatedVersions: ['1.0'],
            minSupportedVersion: '1.0'
        });
    }
}

// Singleton instance
let versionManagerInstance: ApiVersionManager | null = null;

export function getApiVersionManager(): ApiVersionManager {
    if (!versionManagerInstance) {
        versionManagerInstance = new ApiVersionManager();
    }
    return versionManagerInstance;
}
