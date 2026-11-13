import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// Defensive isolation even when this file is run directly (without npm test).
const fallbackRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'causalotel-server-test-'));
if (!process.env.CAUSALOTEL_TEST_ROOT) {
    process.env.CAUSALOTEL_TEST_ROOT = fallbackRoot;
    process.env.LOCALAPPDATA = fallbackRoot;
    process.env.SPOOL_DIR = path.join(fallbackRoot, 'CausalOTel', 'spool', 'incidents');
    fs.mkdirSync(process.env.SPOOL_DIR, { recursive: true });
}

const {
    default: app,
    tempoClient,
    prometheusClient,
    incidentStore,
    incidentSpool,
    serviceHealthProbe,
    topologyService,
    buildTraceSearchQuery
} = await import('../src/server.js');
const { TempoError } = await import('../src/tempo_client.js');
const { PrometheusError } = await import('../src/prometheus_client.js');
const { IncidentStore } = await import('../src/incident_store.js');

const spoolDir = path.resolve(process.env.SPOOL_DIR);
const escapeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'causalotel-escape-target-'));

function filesOutsideSpool() {
    return fs.readdirSync(path.dirname(spoolDir))
        .filter(name => name.endsWith('.json'));
}

describe('Analysis Engine Server & Health Endpoints', () => {
    let server;
    let baseUrl;

    before(async () => {
        return new Promise((resolve) => {
            server = http.createServer(app);
            server.listen(0, () => {
                const port = server.address().port;
                baseUrl = `http://127.0.0.1:${port}`;
                resolve();
            });
        });
    });

    after(async () => {
        await new Promise((resolve) => {
            server.close(resolve);
        });
        try {
            fs.rmSync(escapeRoot, { recursive: true, force: true });
        } catch {
            // Best-effort cleanup of the isolated test directory only.
        }
        if (process.env.CAUSALOTEL_TEST_ROOT === fallbackRoot) {
            try {
                fs.rmSync(fallbackRoot, { recursive: true, force: true });
            } catch {
                // Best-effort cleanup of the isolated test directory only.
            }
        }
    });

    test('GET /health/live returns 200 UP', async () => {
        const res = await fetch(`${baseUrl}/health/live`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.status, 'UP');
        assert.equal(body.service, 'analysis-engine');
    });

    test('GET /health/ready reports the durable disk spool, not MongoDB', async () => {
        const res = await fetch(`${baseUrl}/health/ready`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.status, 'UP');
        assert.equal(body.store, 'disk-spool');
        assert.equal(typeof body.pendingIncidentsCount, 'number');
    });

    test('GET /metrics returns 200 with Prometheus text format', async () => {
        const res = await fetch(`${baseUrl}/metrics`);
        assert.equal(res.status, 200);
        const text = await res.text();
        assert.ok(text.includes('causalotel_analysis_'));
        assert.ok(text.includes('http_server_requests_seconds_count'));
    });

    test('GET /api/analysis returns 200 baseline contract', async () => {
        const res = await fetch(`${baseUrl}/api/analysis`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.status, 'UP');
        assert.equal(typeof body.pendingIncidentsCount, 'number');
        assert.equal(typeof body.incidentCount, 'number');
    });

    test('POST /api/analysis/spool with missing incidentId returns 400 application/problem+json', async () => {
        const res = await fetch(`${baseUrl}/api/analysis/spool`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: { test: true } })
        });

        assert.equal(res.status, 400);
        assert.equal(res.headers.get('content-type'), 'application/problem+json; charset=utf-8');
        const problem = await res.json();
        assert.equal(problem.status, 400);
        assert.equal(problem.type, 'https://causalotel.io/errors/400');
        assert.equal(problem.code, 'INVALID_INCIDENT_ID');
        assert.ok(problem.detail.includes('incidentId is required'));
    });

    test('Path traversal and malformed incident IDs are rejected with no out-of-spool writes', async () => {
        const longId = 'a'.repeat(129);
        const absoluteTarget = path.join(escapeRoot, 'absolute-escape');
        const cases = [
            '../escape',
            '..\\escape',
            'x/../../escaped',
            'x\\..\\..\\escaped',
            '/tmp/evil',
            'C:\\temp\\evil',
            absoluteTarget,
            'a\0b',
            '.',
            '..',
            longId
        ];

        for (const incidentId of cases) {
            const res = await fetch(`${baseUrl}/api/analysis/spool`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ incidentId, data: { probe: true } })
            });
            assert.equal(res.status, 400, `expected 400 for incidentId=${JSON.stringify(incidentId)}`);
            const problem = await res.json();
            assert.equal(problem.code, 'INVALID_INCIDENT_ID');
        }

        assert.equal(fs.existsSync(`${absoluteTarget}.json`), false);
        assert.deepEqual(filesOutsideSpool(), []);
    });

    test('A valid UUID incident is spooled and readable through the API', async () => {
        const incidentId = crypto.randomUUID();
        const res = await fetch(`${baseUrl}/api/analysis/spool`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ incidentId, data: { traceId: 'abc', probe: true } })
        });

        assert.equal(res.status, 202);
        const body = await res.json();
        assert.equal(body.status, 'SPOOLED');
        assert.equal(body.incidentId, incidentId);
        assert.ok(body.spoolFile.endsWith(`${incidentId}.json`));

        const detail = await fetch(`${baseUrl}/api/analysis/incidents/${incidentId}`);
        assert.equal(detail.status, 200);
        const incident = await detail.json();
        assert.equal(incident.incidentId, incidentId);
        assert.equal(incident.probe, true);
    });

    test('Incident persistence survives a store restart', async () => {
        const incidentId = `inc-restart-${crypto.randomUUID()}`;
        await incidentStore.saveIncident({ incidentId, traceId: 'restart-trace', severity: 'HIGH' });

        const restarted = new IncidentStore(incidentSpool);
        const drain = await restarted.drainSpool();
        assert.ok(drain.loaded >= 1);

        const loaded = await restarted.getIncident(incidentId);
        assert.ok(loaded, 'incident must be hydrated from the durable spool after restart');
        assert.equal(loaded.traceId, 'restart-trace');
    });

    test('Tempo 404 maps to 404 TRACE_NOT_FOUND and creates no incident', async () => {
        const before = (await incidentStore.listIncidents()).length;
        const original = tempoClient.fetchTrace;
        tempoClient.fetchTrace = async () => {
            throw new TempoError('Trace not found', { status: 404, code: 'TRACE_NOT_FOUND' });
        };
        try {
            const res = await fetch(`${baseUrl}/api/analysis/analyze-trace`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ traceId: 'does-not-exist' })
            });
            assert.equal(res.status, 404);
            const problem = await res.json();
            assert.equal(problem.code, 'TRACE_NOT_FOUND');
            assert.equal(problem.title, 'Not Found');
            assert.equal((await incidentStore.listIncidents()).length, before);
        } finally {
            tempoClient.fetchTrace = original;
        }
    });

    test('Tempo outage maps to 503 TEMPO_UNAVAILABLE and creates no incident', async () => {
        const before = (await incidentStore.listIncidents()).length;
        const original = tempoClient.fetchTrace;
        tempoClient.fetchTrace = async () => {
            throw new TempoError('Tempo is unavailable', { status: 503, code: 'TEMPO_UNAVAILABLE' });
        };
        try {
            const res = await fetch(`${baseUrl}/api/analysis/analyze-trace`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ traceId: 'abc123' })
            });
            assert.equal(res.status, 503);
            const problem = await res.json();
            assert.equal(problem.code, 'TEMPO_UNAVAILABLE');
            assert.equal((await incidentStore.listIncidents()).length, before);
        } finally {
            tempoClient.fetchTrace = original;
        }
    });

    test('Malformed Tempo response maps to 502 and creates no incident', async () => {
        const before = (await incidentStore.listIncidents()).length;
        const original = tempoClient.fetchTrace;
        tempoClient.fetchTrace = async () => {
            throw new TempoError('Tempo returned malformed JSON', {
                status: 502,
                code: 'TEMPO_INVALID_RESPONSE'
            });
        };
        try {
            const res = await fetch(`${baseUrl}/api/analysis/analyze-trace`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ traceId: 'abc123' })
            });
            assert.equal(res.status, 502);
            const problem = await res.json();
            assert.equal(problem.code, 'TEMPO_INVALID_RESPONSE');
            assert.equal((await incidentStore.listIncidents()).length, before);
        } finally {
            tempoClient.fetchTrace = original;
        }
    });

    test('Prometheus outage returns 503 with an explicit unavailable code', async () => {
        const original = prometheusClient.getServiceMetrics;
        prometheusClient.getServiceMetrics = async () => {
            throw new PrometheusError('Prometheus is unavailable', {
                status: 503,
                code: 'PROMETHEUS_UNAVAILABLE'
            });
        };
        try {
            const res = await fetch(`${baseUrl}/api/analysis/metrics`);
            assert.equal(res.status, 503);
            const problem = await res.json();
            assert.equal(problem.code, 'PROMETHEUS_UNAVAILABLE');
            assert.equal(problem.status, 503);
        } finally {
            prometheusClient.getServiceMetrics = original;
        }
    });

    test('Demo fixture endpoint is disabled by default', async () => {
        const res = await fetch(`${baseUrl}/api/analysis/demo-trace`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ traceId: 'demo' })
        });
        assert.equal(res.status, 404);
        const problem = await res.json();
        assert.equal(problem.code, 'DEMO_FIXTURES_DISABLED');
    });

    test('GET /api/analysis/services reports real probe results', async () => {
        const original = serviceHealthProbe.probeAll;
        serviceHealthProbe.probeAll = async () => ({
            checkedAt: new Date().toISOString(),
            upCount: 1,
            totalCount: 2,
            services: [
                { name: 'up-service', port: 1, status: 'UP', httpStatus: 200, latencyMs: 3 },
                { name: 'down-service', port: 2, status: 'UNREACHABLE', httpStatus: null, latencyMs: 4, error: 'CONNECTION_REFUSED' }
            ]
        });
        try {
            const res = await fetch(`${baseUrl}/api/analysis/services`);
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.upCount, 1);
            assert.equal(body.totalCount, 2);
            assert.equal(body.services[1].status, 'UNREACHABLE');
        } finally {
            serviceHealthProbe.probeAll = original;
        }
    });

    test('GET /api/analysis/traces/:id returns real span detail without fabrication', async () => {
        const original = tempoClient.fetchTrace;
        tempoClient.fetchTrace = async (traceId) => ({
            traceId,
            totalSpans: 2,
            spans: [
                {
                    spanId: 'span-a', parentSpanId: null, name: 'POST /checkout',
                    serviceName: 'order-service', kind: 'SPAN_KIND_SERVER',
                    startMs: 1000, durationMs: 250.5, selfTimeMs: 200.5,
                    statusCode: 'OK', statusMessage: '', timingEngine: 'interval-union',
                    attributes: { 'http.status_code': 200, 'user.email': 'must-not-leak' }
                },
                {
                    spanId: 'span-b', parentSpanId: 'span-a', name: 'POST /charge',
                    serviceName: 'payment-service', kind: 'SPAN_KIND_CLIENT',
                    startMs: 1050, durationMs: 100, selfTimeMs: 100,
                    statusCode: 'ERROR', statusMessage: 'gateway timeout',
                    timingEngine: 'interval-union', attributes: { 'http.status_code': 504 }
                }
            ]
        });
        try {
            const res = await fetch(`${baseUrl}/api/analysis/traces/trace-123`);
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.source, 'tempo');
            assert.equal(body.synthetic, false, 'real Tempo detail must be explicitly marked non-synthetic');
            assert.equal(body.totalSpans, 2);
            assert.equal(body.spans[1].serviceName, 'payment-service');
            assert.equal(body.spans[1].selfTimeMs, 100);
            assert.equal(body.spans[0].attributes['http.status_code'], 200);
            assert.equal(body.spans[0].attributes['user.email'], undefined,
                'non-telemetry attributes must not be exposed to the dashboard');
        } finally {
            tempoClient.fetchTrace = original;
        }
    });

    test('trace filters are escaped into exact TraceQL clauses', () => {
        assert.equal(
            buildTraceSearchQuery({ operation: 'http post /api/orders/checkout' }),
            '{ rootName = "http post /api/orders/checkout" }'
        );
        assert.equal(
            buildTraceSearchQuery({ service: 'order-service', operation: 'a"b\\c' }),
            '{ resource.service.name = "order-service" && rootName = "a\\"b\\\\c" }'
        );
        assert.equal(buildTraceSearchQuery({}), null);
        assert.throws(
            () => buildTraceSearchQuery({ operation: 'x'.repeat(201) }),
            err => err.status === 400 && err.code === 'INVALID_TRACE_FILTER'
        );
    });

    test('GET /api/analysis/traces pushes the operation filter into Tempo search', async () => {
        const original = tempoClient.listTraces;
        let seenLimit = null;
        let seenOptions = null;
        tempoClient.listTraces = async (limit, options) => {
            seenLimit = limit;
            seenOptions = options;
            return [{
                traceId: 'checkout-trace',
                rootService: 'order-service',
                rootOperation: 'http post /api/orders/checkout'
            }];
        };
        try {
            const operation = encodeURIComponent('http post /api/orders/checkout');
            const res = await fetch(`${baseUrl}/api/analysis/traces?limit=7&operation=${operation}`);
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(seenLimit, '7');
            assert.equal(seenOptions.query, '{ rootName = "http post /api/orders/checkout" }');
            assert.equal(body.filter.operation, 'http post /api/orders/checkout');
            assert.equal(body.traces[0].traceId, 'checkout-trace');
        } finally {
            tempoClient.listTraces = original;
        }
    });

    test('GET /api/analysis/graph is derived from Tempo spans and reports cache metadata', async () => {
        const originalList = tempoClient.listTraces;
        const originalFetch = tempoClient.fetchTrace;
        const originalProbe = serviceHealthProbe.probeAll;
        topologyService.clearCache();
        tempoClient.listTraces = async () => [{ traceId: 'trace-graph-1' }];
        tempoClient.fetchTrace = async (traceId) => ({
            traceId,
            source: 'tempo',
            synthetic: false,
            totalSpans: 2,
            spans: [
                {
                    spanId: 'span-root', parentSpanId: null, name: 'POST /checkout',
                    serviceName: 'order-service', durationMs: 120, statusCode: 'OK'
                },
                {
                    spanId: 'span-child', parentSpanId: 'span-root', name: 'POST /reserve',
                    serviceName: 'inventory-service', durationMs: 40, statusCode: 'ERROR'
                }
            ]
        });
        serviceHealthProbe.probeAll = async () => ({
            checkedAt: '2026-01-01T00:00:00.000Z',
            upCount: 1,
            totalCount: 2,
            services: [
                { name: 'order-service', status: 'UP', httpStatus: 200, latencyMs: 2 },
                { name: 'inventory-service', status: 'UNREACHABLE', httpStatus: null, latencyMs: 1500, error: 'CONNECTION_REFUSED' }
            ]
        });

        try {
            const res = await fetch(`${baseUrl}/api/analysis/graph?window=15m&limit=5`);
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.source, 'tempo');
            assert.equal(body.window, '15m');
            assert.equal(body.traceCount, 1);
            assert.equal(body.cache.hit, false);
            assert.deepEqual(
                body.edges.map(edge => ({
                    from: edge.from, to: edge.to, callCount: edge.callCount, errorCount: edge.errorCount
                })),
                [{ from: 'order-service', to: 'inventory-service', callCount: 1, errorCount: 1 }]
            );
            const inventoryNode = body.nodes.find(node => node.id === 'inventory-service');
            assert.equal(inventoryNode.health.status, 'UNREACHABLE');
            assert.equal(inventoryNode.health.error, 'CONNECTION_REFUSED');

            const cachedRes = await fetch(`${baseUrl}/api/analysis/graph?window=15m&limit=5`);
            const cachedBody = await cachedRes.json();
            assert.equal(cachedBody.cache.hit, true);
            assert.equal(cachedBody.generatedAt, body.generatedAt);
            assert.deepEqual(cachedBody.edges, body.edges);
        } finally {
            tempoClient.listTraces = originalList;
            tempoClient.fetchTrace = originalFetch;
            serviceHealthProbe.probeAll = originalProbe;
            topologyService.clearCache();
        }
    });

    test('GET /api/analysis/graph returns an explicit empty graph when Tempo has no traces', async () => {
        const originalList = tempoClient.listTraces;
        const originalProbe = serviceHealthProbe.probeAll;
        topologyService.clearCache();
        tempoClient.listTraces = async () => [];
        serviceHealthProbe.probeAll = async () => ({
            checkedAt: new Date().toISOString(), upCount: 0, totalCount: 0, services: []
        });

        try {
            const res = await fetch(`${baseUrl}/api/analysis/graph?window=1h`);
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.source, 'tempo');
            assert.equal(body.window, '1h');
            assert.equal(body.traceCount, 0);
            assert.deepEqual(body.nodes, []);
            assert.deepEqual(body.edges, []);
        } finally {
            tempoClient.listTraces = originalList;
            serviceHealthProbe.probeAll = originalProbe;
            topologyService.clearCache();
        }
    });

    test('GET /api/analysis/graph maps a Tempo outage to 503 problem details', async () => {
        const originalList = tempoClient.listTraces;
        topologyService.clearCache();
        tempoClient.listTraces = async () => {
            throw new TempoError('Tempo is unavailable', { status: 503, code: 'TEMPO_UNAVAILABLE' });
        };

        try {
            const res = await fetch(`${baseUrl}/api/analysis/graph`);
            assert.equal(res.status, 503);
            assert.match(res.headers.get('content-type'), /application\/problem\+json/);
            const problem = await res.json();
            assert.equal(problem.code, 'TEMPO_UNAVAILABLE');
            assert.equal(problem.instance, '/api/analysis/graph');
        } finally {
            tempoClient.listTraces = originalList;
            topologyService.clearCache();
        }
    });

    test('GET /api/analysis/graph rejects a malformed window', async () => {
        topologyService.clearCache();
        const res = await fetch(`${baseUrl}/api/analysis/graph?window=forever`);
        assert.equal(res.status, 400);
        const problem = await res.json();
        assert.equal(problem.code, 'INVALID_WINDOW');
    });

    test('GET /api/analysis/native-core reports the real CMake target state', async () => {
        const res = await fetch(`${baseUrl}/api/analysis/native-core`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.target, 'sweep_line');
        assert.equal(typeof body.available, 'boolean');
        assert.ok(body.buildCommand.includes('cmake'));
        assert.ok(Array.isArray(body.checkedPaths));
        assert.ok(body.checkedPaths.some(candidate => candidate.relative.includes('sweep_line')));
        if (!body.available) {
            assert.equal(body.binary, null);
            assert.ok(body.expectedBinary.endsWith('sweep_line.exe'));
        }
    });

    test('GET /api/analysis/traces/:id maps Tempo 404 to problem details', async () => {
        const original = tempoClient.fetchTrace;
        tempoClient.fetchTrace = async () => {
            throw new TempoError('Trace not found', { status: 404, code: 'TRACE_NOT_FOUND' });
        };
        try {
            const res = await fetch(`${baseUrl}/api/analysis/traces/missing-trace`);
            assert.equal(res.status, 404);
            const problem = await res.json();
            assert.equal(problem.code, 'TRACE_NOT_FOUND');
        } finally {
            tempoClient.fetchTrace = original;
        }
    });
});
