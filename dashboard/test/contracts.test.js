import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeApiError,
  faultResetRequests,
  inventoryFaultPayload,
  normalizeIncident,
  normalizeIncidentList,
  normalizeMetricsResponse,
  normalizeServiceHealth,
  normalizeTraceDetail,
  normalizeTracesResponse,
  paymentFaultPayload
} from '../src/lib/contracts.js';

describe('incident contract', () => {
  test('maps a real flat RCA record without inventing fields', () => {
    const normalized = normalizeIncident({
      incidentId: 'inc-abc123',
      traceId: 'trace-1',
      culpritService: 'payment-service',
      rootCauseType: 'GATEWAY_TIMEOUT',
      severity: 'HIGH',
      confidenceScore: 0.75,
      summary: 'payment-service reported GATEWAY_TIMEOUT',
      status: 'ACTIVE',
      analyzedAt: '2026-01-01T00:00:00.000Z',
      evidence: [{ type: 'HTTP_STATUS_CODE', description: 'HTTP 504', severity: 'HIGH', value: '504' }],
      remediations: ['Inspect the gateway'],
      causalPath: [{ service: 'order-service', latency: '250ms', status: 'ERROR' }],
      sweepLineMetrics: { netSelfTimeMs: 250 },
      metricsAvailable: false,
      metricsError: { code: 'PROMETHEUS_UNAVAILABLE', message: 'down' }
    });

    assert.equal(normalized.incidentId, 'inc-abc123');
    assert.equal(normalized.culpritService, 'payment-service');
    assert.equal(normalized.confidenceScore, 0.75);
    assert.equal(normalized.evidence[0].type, 'HTTP_STATUS_CODE');
    assert.equal(normalized.remediations.length, 1);
    assert.equal(normalized.metricsAvailable, false);
    assert.equal(normalized.createdAt, '2026-01-01T00:00:00.000Z');
    assert.equal(normalized.synthetic, false);
  });

  test('returns null rather than fabricating an incident without an id', () => {
    assert.equal(normalizeIncident({ culpritService: 'payment-service' }), null);
    assert.equal(normalizeIncident(null), null);
  });

  test('drops invalid records from a list', () => {
    const list = normalizeIncidentList([
      { incidentId: 'inc-1', culpritService: 'order-service' },
      { culpritService: 'payment-service' },
      null
    ]);
    assert.equal(list.length, 1);
    assert.equal(list[0].incidentId, 'inc-1');
    assert.equal(list[0].rootCauseType, 'UNKNOWN');
    assert.equal(list[0].confidenceScore, null);
  });
});

describe('metrics contract', () => {
  test('preserves unavailable services with null metrics instead of zeros', () => {
    const metrics = normalizeMetricsResponse({
      source: 'prometheus',
      generatedAt: '2026-01-01T00:00:00.000Z',
      window: '1m',
      services: {
        'payment-service': {
          service: 'payment-service',
          port: 8084,
          available: false,
          reason: 'NO_METRICS',
          status: 'UNKNOWN'
        },
        'order-service': {
          service: 'order-service',
          port: 8083,
          available: true,
          requestRate: 2.5,
          errorRate: 0.01,
          p50LatencyMs: 10,
          p95LatencyMs: 20,
          p99LatencyMs: 30,
          status: 'HEALTHY'
        }
      }
    });

    const payment = metrics.services.find(service => service.service === 'payment-service');
    assert.equal(payment.available, false);
    assert.equal(payment.requestRate, null);
    assert.equal(payment.p99LatencyMs, null);
    assert.equal(payment.reason, 'NO_METRICS');

    assert.equal(metrics.reportingCount, 1);
    assert.equal(metrics.totalCount, 2);
    assert.equal(metrics.totalRequestRate, 2.5);
    assert.equal(metrics.worstP99LatencyMs, 30);
  });

  test('reports no aggregate values when nothing is reporting', () => {
    const metrics = normalizeMetricsResponse({ services: {} });
    assert.equal(metrics.reportingCount, 0);
    assert.equal(metrics.totalRequestRate, null);
    assert.equal(metrics.averageErrorRate, null);
    assert.equal(metrics.worstP99LatencyMs, null);
  });
});

describe('trace contracts', () => {
  test('maps Tempo list entries and drops entries without a trace id', () => {
    const traces = normalizeTracesResponse({
      traces: [
        {
          traceId: 'abc',
          rootService: 'order-service',
          rootOperation: 'POST /checkout',
          durationMs: 12.5,
          status: 'OK',
          startTimeUnixNano: '1700000000000000000'
        },
        { rootService: 'order-service' }
      ]
    });
    assert.equal(traces.length, 1);
    assert.equal(traces[0].traceId, 'abc');
    assert.equal(traces[0].durationMs, 12.5);
  });

  test('computes trace offsets and total duration from real spans', () => {
    const detail = normalizeTraceDetail({
      traceId: 'abc',
      totalSpans: 2,
      spans: [
        {
          spanId: 'b',
          parentSpanId: 'a',
          name: 'POST /charge',
          serviceName: 'payment-service',
          startMs: 1100,
          durationMs: 50,
          selfTimeMs: 50,
          statusCode: 'ERROR',
          statusMessage: 'timeout',
          timingEngine: 'interval-union',
          attributes: { 'http.status_code': 504 }
        },
        {
          spanId: 'a',
          parentSpanId: null,
          name: 'POST /checkout',
          serviceName: 'order-service',
          startMs: 1000,
          durationMs: 200,
          selfTimeMs: 150,
          statusCode: 'OK',
          statusMessage: '',
          timingEngine: 'interval-union',
          attributes: {}
        }
      ]
    });

    assert.equal(detail.totalDurationMs, 200);
    assert.equal(detail.spans[0].spanId, 'a');
    assert.equal(detail.spans[0].startOffsetMs, 0);
    assert.equal(detail.spans[1].startOffsetMs, 100);
    assert.equal(detail.spans[1].attributes['http.status_code'], 504);
  });

  test('never fabricates spans for an empty payload', () => {
    const detail = normalizeTraceDetail({ traceId: 'empty' });
    assert.equal(detail.spans.length, 0);
    assert.equal(detail.totalSpans, 0);
    assert.equal(detail.totalDurationMs, 0);
  });
});

describe('health contract', () => {
  test('preserves explicit DOWN and UNREACHABLE states', () => {
    const health = normalizeServiceHealth({
      checkedAt: '2026-01-01T00:00:00.000Z',
      upCount: 1,
      totalCount: 3,
      services: [
        { name: 'user-service', port: 8081, status: 'UP', latencyMs: 3 },
        { name: 'order-service', port: 8083, status: 'DOWN', httpStatus: 503, latencyMs: 4 },
        { name: 'payment-service', port: 8084, status: 'UNREACHABLE', error: 'CONNECTION_REFUSED' }
      ]
    });
    assert.equal(health.services[1].status, 'DOWN');
    assert.equal(health.services[2].status, 'UNREACHABLE');
    assert.equal(health.services[2].error, 'CONNECTION_REFUSED');
  });
});

describe('fault payload contracts', () => {
  test('payment payload matches the backend FaultConfig record', () => {
    assert.deepEqual(
      paymentFaultPayload({ latencyMs: 3000, faultMode: 'LATENCY' }),
      { latencyMs: 3000, faultMode: 'LATENCY', errorMessage: null }
    );
  });

  test('inventory payload matches the PascalCase FaultRequest record', () => {
    assert.deepEqual(
      inventoryFaultPayload({ simulateBusy: true }),
      { LatencyMs: 0, SimulateBusy: true, SimulateError: false, ErrorMessage: null }
    );
  });

  test('reset requests cover both services with NORMAL state', () => {
    const requests = faultResetRequests();
    assert.equal(requests.length, 2);
    assert.equal(requests[0].endpoint, '/api/payments/fault');
    assert.equal(requests[0].body.faultMode, 'NORMAL');
    assert.equal(requests[1].endpoint, '/api/inventory/fault');
    assert.equal(requests[1].body.SimulateBusy, false);
    assert.equal(requests[1].body.SimulateError, false);
  });
});

describe('problem details contract', () => {
  test('extracts RFC 9457 fields without leaking an HTML body', () => {
    const described = describeApiError({
      response: {
        status: 503,
        data: {
          title: 'Service Unavailable',
          code: 'TEMPO_UNAVAILABLE',
          detail: 'Tempo is unreachable',
          traceId: 'trace-1'
        }
      }
    });
    assert.deepEqual(described, {
      status: 503,
      code: 'TEMPO_UNAVAILABLE',
      detail: 'Tempo is unreachable',
      traceId: 'trace-1'
    });
  });

  test('falls back to the transport message when no body exists', () => {
    const described = describeApiError({ message: 'Network Error' });
    assert.equal(described.status, null);
    assert.equal(described.code, null);
    assert.equal(described.detail, 'Network Error');
  });
});
