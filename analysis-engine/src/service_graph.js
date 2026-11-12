/**
 * M-05: Runtime service dependency graph derived from recent Tempo traces.
 *
 * The graph is never a static topology. Nodes and edges come from real
 * parent/child span relationships, edges carry call/error counts, and nodes
 * carry live health-probe metadata. Results are cached briefly and always
 * expose their source, window, and cache timestamps so callers can tell how
 * fresh the topology is.
 */

import { DependencyGraph } from './graph.js';
import { TempoError } from './tempo_client.js';

const WINDOW_PATTERN = /^(\d{1,4})(s|m|h)$/;
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_TRACES = 50;

export function parseWindow(window) {
    if (typeof window !== 'string' || !WINDOW_PATTERN.test(window)) {
        throw new TempoError(
            'window must be a duration such as 30s, 15m, 1h, or 24h',
            { status: 400, code: 'INVALID_WINDOW' }
        );
    }

    const [, amountText, unit] = window.match(WINDOW_PATTERN);
    const amount = Number.parseInt(amountText, 10);
    const multiplier = unit === 's' ? 1000 : unit === 'm' ? 60_000 : 3_600_000;
    const windowMs = amount * multiplier;

    if (windowMs < 1000 || windowMs > MAX_WINDOW_MS) {
        throw new TempoError(
            'window must be between 1s and 24h',
            { status: 400, code: 'INVALID_WINDOW' }
        );
    }

    return { label: window, windowMs };
}

export function parseTraceLimit(limit) {
    const parsed = Number.parseInt(limit, 10);
    if (limit === undefined || limit === null || Number.isNaN(parsed)) {
        return 20;
    }
    return Math.max(1, Math.min(MAX_TRACES, parsed));
}

function round(value) {
    return Math.round(value * 100) / 100;
}

/**
 * Build a DependencyGraph from normalized Tempo trace details.
 * A service-to-service edge exists only when a span's direct parent belongs
 * to a different service, which is the real RPC boundary in the trace.
 */
export function buildServiceGraph(traces, options = {}) {
    const graph = new DependencyGraph();
    const nodeStats = new Map();
    const edgeStats = new Map();
    let spanCount = 0;
    let errorSpanCount = 0;

    for (const trace of traces || []) {
        const spans = Array.isArray(trace?.spans) ? trace.spans : [];
        const spansById = new Map(spans.map(span => [span.spanId, span]));

        for (const span of spans) {
            const serviceName = span.serviceName || 'unknown-service';
            graph.addNode(serviceName);

            const stats = nodeStats.get(serviceName) || {
                spanCount: 0,
                errorCount: 0,
                totalDurationMs: 0
            };
            stats.spanCount += 1;
            stats.totalDurationMs += Number(span.durationMs) || 0;
            if (span.statusCode === 'ERROR') {
                stats.errorCount += 1;
                errorSpanCount += 1;
            }
            nodeStats.set(serviceName, stats);
            spanCount += 1;

            const parent = span.parentSpanId ? spansById.get(span.parentSpanId) : null;
            if (!parent || !parent.serviceName || parent.serviceName === serviceName) {
                continue;
            }

            graph.addEdge(parent.serviceName, serviceName);
            const key = `${parent.serviceName}\u0000${serviceName}`;
            const edge = edgeStats.get(key) || {
                callCount: 0,
                errorCount: 0,
                totalDurationMs: 0
            };
            edge.callCount += 1;
            edge.totalDurationMs += Number(span.durationMs) || 0;
            if (span.statusCode === 'ERROR') {
                edge.errorCount += 1;
            }
            edgeStats.set(key, edge);
        }
    }

    const base = graph.toJSON();
    const healthByName = new Map(
        (options.health?.services || []).map(service => [service.name, service])
    );

    const nodes = base.nodes.map(node => {
        const stats = nodeStats.get(node.id) || { spanCount: 0, errorCount: 0, totalDurationMs: 0 };
        const health = healthByName.get(node.id);
        return {
            id: node.id,
            name: node.id,
            spanCount: stats.spanCount,
            errorCount: stats.errorCount,
            avgDurationMs: round(stats.totalDurationMs / Math.max(1, stats.spanCount)),
            health: health
                ? {
                    status: health.status,
                    httpStatus: health.httpStatus ?? null,
                    latencyMs: health.latencyMs ?? null,
                    error: health.error || null
                }
                : { status: 'UNKNOWN', httpStatus: null, latencyMs: null, error: null }
        };
    });

    const edges = base.edges.map(edge => {
        const stats = edgeStats.get(`${edge.from}\u0000${edge.to}`);
        return {
            from: edge.from,
            to: edge.to,
            callCount: stats?.callCount || 0,
            errorCount: stats?.errorCount || 0,
            avgDurationMs: round((stats?.totalDurationMs || 0) / Math.max(1, stats?.callCount || 0))
        };
    }).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

    return {
        source: options.source || 'tempo',
        generatedAt: options.generatedAt || new Date().toISOString(),
        window: options.window || '15m',
        windowMs: options.windowMs || null,
        limit: options.limit ?? null,
        traceCount: Array.isArray(traces) ? traces.length : 0,
        listedTraceCount: options.listedTraceCount ?? (Array.isArray(traces) ? traces.length : 0),
        failedTraceCount: options.failedTraceCount || 0,
        spanCount,
        errorSpanCount,
        degraded: (options.failedTraceCount || 0) > 0,
        healthCheckedAt: options.health?.checkedAt || null,
        nodes,
        edges,
        sccs: base.sccs,
        cyclicComponents: base.cyclicComponents,
        hasCycle: base.hasCycle
    };
}

export class ServiceGraphService {
    constructor({ tempoClient, healthProbe, cacheTtlMs, now = () => Date.now() } = {}) {
        if (!tempoClient) {
            throw new Error('ServiceGraphService requires a tempoClient');
        }
        this.tempoClient = tempoClient;
        this.healthProbe = healthProbe || null;
        this.cacheTtlMs = cacheTtlMs
            ?? (parseInt(process.env.GRAPH_CACHE_TTL_MS, 10) || 15_000);
        this.now = now;
        this.cache = new Map();
    }

    clearCache() {
        this.cache.clear();
    }

    async getGraph({ window = '15m', limit = 20 } = {}) {
        const parsedWindow = parseWindow(window);
        const boundedLimit = parseTraceLimit(limit);
        const now = this.now();
        const cacheKey = `${parsedWindow.label}:${boundedLimit}`;

        const cached = this.cache.get(cacheKey);
        if (cached && cached.expiresAt > now) {
            return {
                ...cached.graph,
                cache: {
                    hit: true,
                    ttlMs: this.cacheTtlMs,
                    cachedAt: new Date(cached.cachedAt).toISOString(),
                    expiresAt: new Date(cached.expiresAt).toISOString(),
                    ageMs: now - cached.cachedAt
                }
            };
        }

        const endMs = now;
        const startMs = now - parsedWindow.windowMs;
        const summaries = await this.tempoClient.listTraces(boundedLimit, { startMs, endMs });
        const listedTraces = Array.isArray(summaries) ? summaries : [];

        const settled = await Promise.allSettled(
            listedTraces
                .filter(summary => typeof summary?.traceId === 'string' && summary.traceId.length > 0)
                .map(summary => this.tempoClient.fetchTrace(summary.traceId))
        );

        const traces = [];
        let failedTraceCount = 0;
        for (const result of settled) {
            if (result.status === 'fulfilled') {
                // Synthetic fixtures are opt-in demo data and must never shape
                // the production topology.
                if (!result.value?.synthetic) {
                    traces.push(result.value);
                }
            } else if (result.reason?.status !== 404) {
                failedTraceCount += 1;
            }
        }

        if (traces.length === 0 && failedTraceCount > 0) {
            throw new TempoError(
                'Recent trace details could not be loaded from Tempo',
                { status: 503, code: 'TEMPO_GRAPH_UNAVAILABLE' }
            );
        }

        let health = null;
        if (this.healthProbe) {
            try {
                health = await this.healthProbe.probeAll();
            } catch {
                // Health is metadata; trace-derived topology remains valid.
                health = null;
            }
        }

        const graph = buildServiceGraph(traces, {
            source: 'tempo',
            generatedAt: new Date(now).toISOString(),
            window: parsedWindow.label,
            windowMs: parsedWindow.windowMs,
            limit: boundedLimit,
            listedTraceCount: listedTraces.length,
            failedTraceCount,
            health
        });

        this.cache.set(cacheKey, {
            graph,
            cachedAt: now,
            expiresAt: now + this.cacheTtlMs
        });

        return {
            ...graph,
            cache: {
                hit: false,
                ttlMs: this.cacheTtlMs,
                cachedAt: new Date(now).toISOString(),
                expiresAt: new Date(now + this.cacheTtlMs).toISOString(),
                ageMs: 0
            }
        };
    }
}

export default ServiceGraphService;
