import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DependencyGraph } from '../src/graph.js';
import { RcaEngine } from '../src/rca_engine.js';
import { TempoClient, TempoError } from '../src/tempo_client.js';
import { PrometheusClient, PrometheusError } from '../src/prometheus_client.js';
import { IncidentStore } from '../src/incident_store.js';
import { IncidentSpool } from '../src/spool.js';

function listen(handler) {
  return new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

function nano(ms) {
  return (BigInt(ms) * 1_000_000n).toString();
}

function otlpTraceFixture() {
  const base = 1_700_000_000_000;
  const traceId = 'a'.repeat(32);
  const span = (spanId, parentSpanId, name, offsetMs, durationMs, statusCode, statusMessage, httpStatus) => ({
    traceId,
    spanId,
    parentSpanId: parentSpanId || undefined,
    name,
    kind: 'SPAN_KIND_INTERNAL',
    startTimeUnixNano: nano(base + offsetMs),
    endTimeUnixNano: nano(base + offsetMs + durationMs),
    status: { code: statusCode, message: statusMessage || '' },
    attributes: httpStatus
      ? [{ key: 'http.status_code', value: { intValue: httpStatus } }]
      : []
  });

  return {
    batches: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'order-service' } }] },
        scopeSpans: [{ spans: [
          span('1111111111111111', null, 'POST /api/orders/checkout', 0, 3250, 2, 'Payment timeout', 500)
        ] }]
      },
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'inventory-service' } }] },
        scopeSpans: [{ spans: [
          span('2222222222222222', '1111111111111111', 'POST /api/inventory/reserve', 50, 130, 0, '', 200),
          span('4444444444444444', '1111111111111111', 'POST /api/inventory/release', 3215, 30, 0, '', 200)
        ] }]
      },
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'payment-service' } }] },
        scopeSpans: [{ spans: [
          span('3333333333333333', '1111111111111111', 'POST /api/payments/charge', 200, 3010, 2, 'Gateway Timeout', 504)
        ] }]
      }
    ]
  };
}

const paymentMetrics = {
  source: 'prometheus',
  services: {
    'payment-service': {
      available: true,
      errorRate: 0.35,
      p95LatencyMs: 3020,
      p50LatencyMs: 120,
      p99LatencyMs: 3450,
      status: 'DEGRADED'
    }
  }
};

function fakeTempoClient(trace) {
  return { fetchTrace: async () => trace };
}

describe('Dependency Graph & Tarjan SCC Algorithm', () => {
  test('BFS finds shortest causal path between microservices', () => {
    const graph = new DependencyGraph();
    graph.addEdge('dashboard', 'order-service');
    graph.addEdge('order-service', 'inventory-service');
    graph.addEdge('order-service', 'payment-service');
    graph.addEdge('payment-service', 'gateway-simulator');

    const path = graph.findShortestPath('dashboard', 'gateway-simulator');
    assert.deepEqual(path, ['dashboard', 'order-service', 'payment-service', 'gateway-simulator']);
  });

  test('Tarjan SCC detects no cycles in DAG', () => {
    const graph = new DependencyGraph();
    graph.addEdge('A', 'B');
    graph.addEdge('B', 'C');
    graph.addEdge('A', 'C');

    assert.equal(graph.hasCycle(), false);
    const sccs = graph.findStronglyConnectedComponents();
    assert.equal(sccs.length, 3);
  });

  test('Tarjan SCC detects cyclic microservice dependency', () => {
    const graph = new DependencyGraph();
    graph.addEdge('service-A', 'service-B');
    graph.addEdge('service-B', 'service-C');
    graph.addEdge('service-C', 'service-A'); // Cycle!

    assert.equal(graph.hasCycle(), true);
    const sccs = graph.findStronglyConnectedComponents();
    const cyclic = sccs.find(s => s.length > 1);
    assert.ok(cyclic, 'Should identify a multi-node cycle');
    assert.equal(cyclic.length, 3);
  });
});

describe('Tempo client error contract', () => {
  test('real Tempo fixture round-trips with the same span count and self-times', async () => {
    const { server, url } = await listen((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(otlpTraceFixture()));
    });

    try {
      const client = new TempoClient(url);
      const trace = await client.fetchTrace('a'.repeat(32));
      assert.equal(trace.totalSpans, 4);
      assert.equal(trace.synthetic, false);
      assert.equal(trace.source, 'tempo');
      const payment = trace.spans.find(s => s.serviceName === 'payment-service');
      assert.equal(payment.durationMs, 3010);
      assert.equal(payment.selfTimeMs, 3010);
    } finally {
      await close(server);
    }
  });

  test('Tempo 404 is a typed 404, not a synthetic trace', async () => {
    const { server, url } = await listen((req, res) => {
      res.statusCode = 404;
      res.end('not found');
    });

    try {
      const client = new TempoClient(url);
      await assert.rejects(
        client.fetchTrace('abc123'),
        err => err instanceof TempoError && err.status === 404 && err.code === 'TRACE_NOT_FOUND'
      );
    } finally {
      await close(server);
    }
  });

  test('Tempo 500 maps to 502 TEMPO_ERROR', async () => {
    const { server, url } = await listen((req, res) => {
      res.statusCode = 500;
      res.end('boom');
    });

    try {
      const client = new TempoClient(url);
      await assert.rejects(
        client.fetchTrace('abc123'),
        err => err instanceof TempoError && err.status === 502 && err.code === 'TEMPO_ERROR'
      );
    } finally {
      await close(server);
    }
  });

  test('Malformed Tempo JSON maps to 502 TEMPO_INVALID_RESPONSE', async () => {
    const { server, url } = await listen((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end('{not json');
    });

    try {
      const client = new TempoClient(url);
      await assert.rejects(
        client.fetchTrace('abc123'),
        err => err instanceof TempoError && err.status === 502 && err.code === 'TEMPO_INVALID_RESPONSE'
      );
    } finally {
      await close(server);
    }
  });

  test('Connection refusal maps to 503 TEMPO_UNAVAILABLE', async () => {
    const client = new TempoClient('http://127.0.0.1:1', { timeoutMs: 250 });
    await assert.rejects(
      client.fetchTrace('abc123'),
      err => err instanceof TempoError && err.status === 503 && err.code === 'TEMPO_UNAVAILABLE'
    );
  });

  test('Trace list is fetched from Tempo and mapped without fabrication', async () => {
    const { server, url } = await listen((req, res) => {
      assert.match(req.url, /^\/api\/search\?limit=10$/);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        traces: [{
          traceID: 'b'.repeat(32),
          rootServiceName: 'order-service',
          rootTraceName: 'POST /api/orders/checkout',
          startTimeUnixNano: '1700000000000000000',
          durationMs: 42
        }]
      }));
    });

    try {
      const client = new TempoClient(url);
      const traces = await client.listTraces(10);
      assert.equal(traces.length, 1);
      assert.equal(traces[0].traceId, 'b'.repeat(32));
      assert.equal(traces[0].rootService, 'order-service');
    } finally {
      await close(server);
    }
  });

  test('Demo fixture is explicitly marked synthetic and never returned by fetchTrace', () => {
    const client = new TempoClient('http://127.0.0.1:1');
    const demo = client.synthesizeTraceForDemo('demo-trace', 'unit test');
    assert.equal(demo.synthetic, true);
    assert.equal(demo.source, 'demo');
    assert.equal(demo.totalSpans, 4);
  });
});

describe('Prometheus client', () => {
  test('maps real PromQL results deterministically and never randomizes', async () => {
    const { server, url } = await listen((req, res) => {
      const query = decodeURIComponent(new URL(req.url, 'http://localhost').searchParams.get('query'));
      let value = '10';
      if (query.includes('histogram_quantile')) value = '250';
      if (query.includes('5..')) value = '0.02';
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        status: 'success',
        data: { resultType: 'vector', result: [{ metric: {}, value: [1700000000, value] }] }
      }));
    });

    try {
      const client = new PrometheusClient(url, { cacheTtlMs: 0 });
      const first = await client.getServiceMetrics({ useCache: false });
      const second = await client.getServiceMetrics({ useCache: false });

      assert.deepEqual(first.services, second.services);
      assert.equal(first.source, 'prometheus');
      const user = first.services['user-service'];
      assert.equal(user.available, true);
      assert.equal(user.requestRate, 10);
      assert.equal(user.errorRate, 0.02);
      assert.equal(user.p95LatencyMs, 250);
      assert.equal(user.status, 'HEALTHY');
    } finally {
      await close(server);
    }
  });

  test('Prometheus outage rejects with 503 instead of returning fabricated metrics', async () => {
    const client = new PrometheusClient('http://127.0.0.1:1', { timeoutMs: 250 });
    await assert.rejects(
      client.getServiceMetrics({ useCache: false }),
      err => err instanceof PrometheusError && err.status === 503 && err.code === 'PROMETHEUS_UNAVAILABLE'
    );
  });
});

describe('Root Cause Analysis Engine', () => {
  test('pinpoints the failing service and exposes the canonical dashboard contract', async () => {
    const trace = new TempoClient().normalizeTrace(otlpTraceFixture());
    const rca = new RcaEngine(
      fakeTempoClient({ ...trace, synthetic: false, source: 'tempo' }),
      { getServiceMetrics: async () => paymentMetrics }
    );

    const result = await rca.analyzeTrace('trace-test-12345');

    assert.equal(result.traceId, 'trace-test-12345');
    assert.equal(result.synthetic, false);
    assert.equal(result.primaryRootCause.service, 'payment-service');
    assert.equal(result.primaryRootCause.confidence, 'HIGH');
    assert.ok(result.primaryRootCause.score >= 0.7);
    assert.ok(result.primaryRootCause.evidenceChain.length >= 2);
    assert.ok(result.primaryRootCause.recommendation.includes('payment'));

    // Canonical flat contract used by the dashboard.
    assert.equal(result.culpritService, 'payment-service');
    assert.equal(result.rootCauseType, 'GATEWAY_TIMEOUT');
    assert.ok(result.confidenceScore >= 0.7);
    assert.ok(Array.isArray(result.evidence));
    assert.ok(result.evidence.length >= 2);
    assert.ok(Array.isArray(result.remediations));
    assert.ok(result.causalPath.length > 0);
    assert.ok(result.sweepLineMetrics.netSelfTimeMs > 2000);
    assert.equal(result.metricsAvailable, true);
  });

  test('metrics outage degrades evidence explicitly instead of fabricating correlation', async () => {
    const trace = new TempoClient().normalizeTrace(otlpTraceFixture());
    const rca = new RcaEngine(
      fakeTempoClient({ ...trace, synthetic: false, source: 'tempo' }),
      { getServiceMetrics: async () => { throw new PrometheusError('down'); } }
    );

    const result = await rca.analyzeTrace('trace-no-metrics');
    assert.equal(result.metricsAvailable, false);
    assert.equal(result.metricsError.code, 'PROMETHEUS_UNAVAILABLE');
    assert.ok(result.evidence.some(item => item.type === 'METRICS_UNAVAILABLE'));
    assert.equal(result.primaryRootCause.service, 'payment-service');
  });

  test('synthetic demo traces are rejected by RCA scoring', async () => {
    const trace = new TempoClient().synthesizeTraceForDemo('demo');
    const rca = new RcaEngine(fakeTempoClient(trace), { getServiceMetrics: async () => paymentMetrics });

    await assert.rejects(
      rca.analyzeTrace('demo'),
      err => err instanceof TempoError && err.code === 'SYNTHETIC_TRACE_REJECTED'
    );
  });
});

describe('IncidentStore durable persistence', () => {
  test('save, restart, hydrate, and list returns the incident', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'causalotel-incident-store-'));
    try {
      const spool = new IncidentSpool({ spoolDir: dir });
      const store = new IncidentStore(spool);
      const saved = await store.saveIncident({
        incidentId: 'inc-sample-01',
        title: 'Payment Timeout',
        severity: 'CRITICAL'
      });

      assert.equal(saved.incidentId, 'inc-sample-01');
      assert.equal((await store.getIncident('inc-sample-01')).title, 'Payment Timeout');
      assert.equal((await store.listIncidents()).length, 1);

      const restarted = new IncidentStore(new IncidentSpool({ spoolDir: dir }));
      const drain = await restarted.drainSpool();
      assert.equal(drain.loaded, 1);
      assert.equal(drain.quarantined, 0);
      const loaded = await restarted.getIncident('inc-sample-01');
      assert.equal(loaded.title, 'Payment Timeout');
      assert.ok(loaded.spoolFile.includes('inc-sample-01'));
      assert.equal(loaded.spoolFile.includes('[object Object]'), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('corrupt spool files are quarantined and do not block hydration', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'causalotel-incident-corrupt-'));
    try {
      const spool = new IncidentSpool({ spoolDir: dir });
      await spool.spoolIncident('inc-good', { title: 'good' });
      fs.writeFileSync(path.join(dir, '9999999999999_inc-bad.json'), '{not json', 'utf8');

      const store = new IncidentStore(spool);
      const drain = await store.drainSpool();
      assert.equal(drain.loaded, 1);
      assert.equal(drain.quarantined, 1);
      assert.ok(await store.getIncident('inc-good'));
      assert.ok(fs.readdirSync(path.join(dir, 'quarantine')).length >= 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('duplicate incident saves are idempotent', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'causalotel-incident-idempotent-'));
    try {
      const spool = new IncidentSpool({ spoolDir: dir });
      const store = new IncidentStore(spool);
      await store.saveIncident({ incidentId: 'inc-dup', title: 'first' });
      await store.saveIncident({ incidentId: 'inc-dup', title: 'second' });
      const files = await spool.listPending();
      assert.equal(files.length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
