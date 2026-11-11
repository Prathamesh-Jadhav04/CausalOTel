import 'dotenv/config';
import express from 'express';
import client from 'prom-client';
import { trace } from '@opentelemetry/api';
import { IncidentSpool } from './spool.js';
import { TempoClient } from './tempo_client.js';
import { PrometheusClient } from './prometheus_client.js';
import { RcaEngine } from './rca_engine.js';
import { IncidentStore } from './incident_store.js';
import { DependencyGraph } from './graph.js';

const app = express();
const port = parseInt(process.env.PORT, 10) || 5000;
const allowDemoFixtures = process.env.ALLOW_DEMO_FIXTURES === 'true' && process.env.NODE_ENV !== 'production';

export const incidentSpool = new IncidentSpool();
export const tempoClient = new TempoClient();
export const prometheusClient = new PrometheusClient();
export const rcaEngine = new RcaEngine(tempoClient, prometheusClient);
export const incidentStore = new IncidentStore(incidentSpool);

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

// List recent traces from Tempo (never fabricated)
app.get('/api/analysis/traces', async (req, res, next) => {
    try {
        const traces = await tempoClient.listTraces(req.query.limit);
        res.json({
            source: 'tempo',
            generatedAt: new Date().toISOString(),
            traces
        });
    } catch (err) {
        next(err);
    }
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

// Dependency Graph Topology with Tarjan SCC
app.get('/api/analysis/graph', (req, res) => {
    const graph = new DependencyGraph();
    // Default system microservices topology
    graph.addEdge('dashboard', 'order-service');
    graph.addEdge('dashboard', 'product-service');
    graph.addEdge('dashboard', 'user-service');
    graph.addEdge('order-service', 'inventory-service');
    graph.addEdge('order-service', 'payment-service');
    graph.addEdge('analysis-engine', 'order-service');
    graph.addEdge('analysis-engine', 'inventory-service');
    graph.addEdge('analysis-engine', 'payment-service');

    res.json(graph.toJSON());
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
