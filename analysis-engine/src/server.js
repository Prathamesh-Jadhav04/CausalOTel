import 'dotenv/config';
import express from 'express';
import client from 'prom-client';
import { trace } from '@opentelemetry/api';
import { IncidentSpool } from './spool.js';
import { TempoClient } from './tempo_client.js';
import { PrometheusClient } from './prometheus_client.js';
import { RcaEngine } from './rca_engine.js';
import { IncidentStore } from './incident_store.js';
import { ServiceGraphService } from './service_graph.js';
import { ServiceHealthProbe } from './service_probe.js';
import { nativeCoreStatus } from './native_core.js';

const app = express();
const port = parseInt(process.env.PORT, 10) || 5000;
const allowDemoFixtures = process.env.ALLOW_DEMO_FIXTURES === 'true' && process.env.NODE_ENV !== 'production';
const MAX_TRACE_FILTER_LENGTH = 200;

export function escapeTraceQlString(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Build a TraceQL filter for the trace list. `operation` matches the root
 * span name exactly; `service` matches any span emitted by that service.
 * Without a filter Tempo returns whatever is newest, which in a live mesh is
 * mostly scheduled maintenance and actuator scrapes.
 */
export function buildTraceSearchQuery({ service, operation } = {}) {
    const clauses = [];

    const add = (field, raw) => {
        if (raw === undefined || raw === null) return;
        const value = String(raw).trim();
        if (value.length === 0) return;
        if (value.length > MAX_TRACE_FILTER_LENGTH) {
            const err = new Error(`Trace filter must be at most ${MAX_TRACE_FILTER_LENGTH} characters`);
            err.status = 400;
            err.code = 'INVALID_TRACE_FILTER';
            throw err;
        }
        clauses.push(`${field} = "${escapeTraceQlString(value)}"`);
    };

    add('resource.service.name', service);
    add('rootName', operation);
    return clauses.length > 0 ? `{ ${clauses.join(' && ')} }` : null;
}

export const incidentSpool = new IncidentSpool();
export const tempoClient = new TempoClient();
export const prometheusClient = new PrometheusClient();
export const rcaEngine = new RcaEngine(tempoClient, prometheusClient);
export const incidentStore = new IncidentStore(incidentSpool);
export const serviceHealthProbe = new ServiceHealthProbe();
export const topologyService = new ServiceGraphService({
    tempoClient,
    healthProbe: serviceHealthProbe
});

// Prometheus Metrics Collection
client.collectDefaultMetrics({ prefix: 'causalotel_analysis_' });

// Real HTTP metrics for this service. The metric name intentionally matches the
// Spring actuator histogram shape so the Prometheus client can query every
// service with one stable contract.
const httpRequestDuration = new client.Histogram({
    name: 'http_server_requests_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
});

app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
        const seconds = Number(process.hrtime.bigint() - started) / 1e9;
        httpRequestDuration.observe({
            method: req.method,
            route: req.route?.path || req.path,
            status: String(res.statusCode)
        }, seconds);
    });
    next();
});

app.use(express.json());

// Prometheus Scraping Endpoint
app.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', client.register.contentType);
        res.end(await client.register.metrics());
    } catch (err) {
        res.status(500).end(err.message);
    }
});

// Health Endpoints
app.get('/health/live', (req, res) => {
    res.json({
        status: 'UP',
        service: 'analysis-engine'
    });
});

app.get('/health/ready', async (req, res) => {
    const health = await incidentStore.checkHealth();
    if (health.healthy) {
        res.json({
            status: 'UP',
            store: health.store,
            pendingIncidentsCount: health.pendingCount,
            lastDrain: incidentStore.lastDrain
        });
    } else {
        res.status(503).json({
            status: 'DOWN',
            store: health.store,
            error: health.error
        });
    }
});

// Baseline API Contract for Analysis Engine
app.get('/api/analysis', async (req, res, next) => {
    try {
        const pending = await incidentSpool.listPending();
        const incidents = await incidentStore.listIncidents();
        res.json({
            status: 'UP',
            pendingIncidentsCount: pending.length,
            incidentCount: incidents.length
        });
    } catch (err) {
        next(err);
    }
});

// List Incidents (durable spool is the source of truth)
app.get('/api/analysis/incidents', async (req, res, next) => {
    try {
        const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
        res.json(await incidentStore.listIncidents(limit));
    } catch (err) {
        next(err);
    }
});

// Get Single Incident Detail
app.get('/api/analysis/incidents/:id', async (req, res, next) => {
    try {
        const incident = await incidentStore.getIncident(req.params.id);
        if (!incident) {
            const err = new Error(`Incident not found: ${req.params.id}`);
            err.status = 404;
            err.code = 'INCIDENT_NOT_FOUND';
            return next(err);
        }
        res.json(incident);
    } catch (err) {
        next(err);
    }
});

// List recent traces from Tempo (never fabricated). Optional `service` and
// `operation` filters are pushed into TraceQL so maintenance traffic cannot
// crowd a specific business trace out of the bounded result set.
app.get('/api/analysis/traces', async (req, res, next) => {
    try {
        const query = buildTraceSearchQuery({
            service: req.query.service,
            operation: req.query.operation
        });
        const traces = await tempoClient.listTraces(req.query.limit, query ? { query } : {});
        res.json({
            source: 'tempo',
            generatedAt: new Date().toISOString(),
            filter: {
                service: req.query.service || null,
                operation: req.query.operation || null,
                query
            },
            traces
        });
    } catch (err) {
        next(err);
    }
});

// Real span-level detail for a single Tempo trace. This feeds the dashboard
// waterfall; Tempo failures propagate as typed problem details.
app.get('/api/analysis/traces/:traceId', async (req, res, next) => {
    try {
        const trace = await tempoClient.fetchTrace(req.params.traceId);
        res.json({
            source: 'tempo',
            synthetic: false,
            traceId: trace.traceId,
            totalSpans: trace.totalSpans,
            spans: trace.spans.map(span => ({
                spanId: span.spanId,
                parentSpanId: span.parentSpanId,
                name: span.name,
                serviceName: span.serviceName,
                kind: span.kind,
                startMs: span.startMs,
                durationMs: Number(span.durationMs.toFixed(1)),
                selfTimeMs: Number(span.selfTimeMs.toFixed(1)),
                statusCode: span.statusCode,
                statusMessage: span.statusMessage,
                timingEngine: span.timingEngine,
                attributes: Object.fromEntries(
                    Object.entries(span.attributes || {})
                        .filter(([key]) => key.startsWith('http.') || key.startsWith('rpc.') || key.startsWith('db.'))
                )
            }))
        });
    } catch (err) {
        next(err);
    }
});

// Real service health probes for the dashboard (never fabricated).
app.get('/api/analysis/services', async (req, res, next) => {
    try {
        res.json(await serviceHealthProbe.probeAll());
    } catch (err) {
        next(err);
    }
});

// L-01: report the actual CMake target/output and whether it exists.
app.get('/api/analysis/native-core', (req, res) => {
    res.json(nativeCoreStatus());
});

// Trigger Root Cause Analysis on a Trace ID
app.post('/api/analysis/analyze-trace', async (req, res, next) => {
    try {
        const { traceId } = req.body || {};
        if (!traceId) {
            const err = new Error('traceId is required');
            err.status = 400;
            err.code = 'INVALID_TRACE_ID';
            throw err;
        }

        const rcaResult = await rcaEngine.analyzeTrace(traceId);
        if (rcaResult.synthetic) {
            // Defense in depth: synthetic fixtures are never persisted.
            return res.json({ ...rcaResult, persisted: false });
        }

        const saved = await incidentStore.saveIncident(rcaResult);
        res.json({ ...rcaResult, incidentId: saved.incidentId, persisted: true });
    } catch (err) {
        next(err);
    }
});

// Explicit opt-in demo fixture endpoint. Disabled unless ALLOW_DEMO_FIXTURES=true.
app.post('/api/analysis/demo-trace', (req, res, next) => {
    if (!allowDemoFixtures) {
        const err = new Error('Demo fixtures are disabled');
        err.status = 404;
        err.code = 'DEMO_FIXTURES_DISABLED';
        return next(err);
    }

    const traceId = req.body?.traceId || 'demo-trace';
    const fixture = tempoClient.synthesizeTraceForDemo(traceId, 'Explicit demo fixture');
    res.json({
        ...fixture,
        persisted: false,
        notice: 'Synthetic demo fixture. This is not real telemetry and is not persisted as an incident.'
    });
});

// M-05: dependency graph derived from recent Tempo spans, with live health
// metadata, a bounded time window, and an explicit short-lived cache.
app.get('/api/analysis/graph', async (req, res, next) => {
    try {
        const graph = await topologyService.getGraph({
            window: req.query.window || '15m',
            limit: req.query.limit
        });
        res.json(graph);
    } catch (err) {
        next(err);
    }
});

// Correlated Prometheus Metrics (explicit unavailable states, no fabrication)
app.get('/api/analysis/metrics', async (req, res, next) => {
    try {
        const metrics = await prometheusClient.getServiceMetrics();
        res.json(metrics);
    } catch (err) {
        next(err);
    }
});

// Incident Spool Ingestion Endpoint
app.post('/api/analysis/spool', async (req, res, next) => {
    try {
        const { incidentId, data } = req.body || {};
        if (!incidentId) {
            const err = new Error('incidentId is required');
            err.status = 400;
            err.code = 'INVALID_INCIDENT_ID';
            throw err;
        }

        const payload = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
        const saved = await incidentStore.saveIncident({ ...payload, incidentId });

        res.status(202).json({
            status: 'SPOOLED',
            incidentId: saved.incidentId,
            spoolFile: saved.spoolFile
        });
    } catch (err) {
        next(err);
    }
});

// RFC 9457 Global Problem Details Error Handler
app.use((err, req, res, next) => {
    const status = Number.isInteger(err.status) ? err.status : 500;
    const titles = {
        400: 'Bad Request',
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'Not Found',
        409: 'Conflict',
        502: 'Bad Gateway',
        503: 'Service Unavailable'
    };

    const safeDetail = status >= 500
        ? 'An upstream dependency or the analysis engine failed to process the request.'
        : (err.detail || err.message || 'Request failed');

    const problem = {
        type: `https://causalotel.io/errors/${status}`,
        title: titles[status] || 'Internal Server Error',
        status,
        code: err.code || `HTTP_${status}`,
        detail: safeDetail,
        instance: req.originalUrl || req.path,
        timestamp: Date.now()
    };

    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
        const traceId = activeSpan.spanContext().traceId;
        if (traceId && traceId !== '00000000000000000000000000000000') {
            problem.traceId = traceId;
        }
    }

    res.status(status);
    res.setHeader('Content-Type', 'application/problem+json');
    res.json(problem);
});

// Start HTTP server if executed directly
async function start() {
    await incidentStore.drainSpool();
    app.listen(port, () => {
        console.log(`CausalOTel RCA Analysis Engine listening on port ${port}`);
    });
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
    start().catch(err => {
        console.error('Failed to start analysis engine:', err);
        process.exit(1);
    });
}

export default app;
