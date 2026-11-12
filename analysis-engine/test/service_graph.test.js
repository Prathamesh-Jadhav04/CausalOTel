import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildServiceGraph,
    BUSINESS_ROOT_QUERY,
    isInfrastructureTrace,
    mapWithConcurrency,
    parseTraceLimit,
    parseWindow,
    ServiceGraphService
} from '../src/service_graph.js';
import { TempoError } from '../src/tempo_client.js';

function traceFixture(traceId, spans) {
    return {
        traceId,
        source: 'tempo',
        synthetic: false,
        totalSpans: spans.length,
        spans
    };
}

function span(spanId, parentSpanId, serviceName, statusCode = 'OK', durationMs = 10) {
    return {
        spanId,
        parentSpanId,
        name: `${serviceName} operation`,
        serviceName,
        startMs: 1000,
        durationMs,
        statusCode,
        statusMessage: statusCode === 'ERROR' ? 'failed' : '',
        attributes: {}
    };
}

describe('M-05 service graph fixtures', () => {
    test('a parent/child span across services creates a counted edge', () => {
        const trace = traceFixture('trace-1', [
            span('root', null, 'order-service', 'OK', 120),
            span('child', 'root', 'inventory-service', 'ERROR', 40)
        ]);

        const graph = buildServiceGraph([trace], { window: '15m', windowMs: 900_000 });

        assert.equal(graph.source, 'tempo');
        assert.equal(graph.window, '15m');
        assert.equal(graph.traceCount, 1);
        assert.equal(graph.spanCount, 2);
        assert.equal(graph.errorSpanCount, 1);
        assert.deepEqual(
            graph.edges.map(edge => ({
                from: edge.from,
                to: edge.to,
                callCount: edge.callCount,
                errorCount: edge.errorCount,
                avgDurationMs: edge.avgDurationMs
            })),
            [{ from: 'order-service', to: 'inventory-service', callCount: 1, errorCount: 1, avgDurationMs: 40 }]
        );
        assert.equal(graph.nodes.length, 2);
    });

    test('different fixtures produce different graphs, not a static topology', () => {
        const first = buildServiceGraph([
            traceFixture('trace-a', [
                span('a1', null, 'order-service'),
                span('a2', 'a1', 'payment-service')
            ])
        ]);
        const second = buildServiceGraph([
            traceFixture('trace-b', [
                span('b1', null, 'product-service'),
                span('b2', 'b1', 'order-service')
            ])
        ]);

        assert.notDeepEqual(first.edges, second.edges);
        assert.deepEqual(first.edges.map(edge => `${edge.from}->${edge.to}`), ['order-service->payment-service']);
        assert.deepEqual(second.edges.map(edge => `${edge.from}->${edge.to}`), ['product-service->order-service']);
    });

    test('same-service parent/child spans do not create a dependency edge', () => {
        const graph = buildServiceGraph([
            traceFixture('trace-local', [
                span('root', null, 'order-service'),
                span('child', 'root', 'order-service')
            ])
        ]);

        assert.deepEqual(graph.edges, []);
        assert.equal(graph.nodes.length, 1);
    });

    test('node health metadata reflects stopped services', () => {
        const graph = buildServiceGraph(
            [traceFixture('trace-health', [
                span('root', null, 'order-service'),
                span('child', 'root', 'payment-service')
            ])],
            {
                health: {
                    checkedAt: '2026-01-01T00:00:00.000Z',
                    services: [
                        { name: 'order-service', status: 'UP', httpStatus: 200, latencyMs: 3 },
                        { name: 'payment-service', status: 'UNREACHABLE', httpStatus: null, latencyMs: 1500, error: 'CONNECTION_REFUSED' }
                    ]
                }
            }
        );

        const payment = graph.nodes.find(node => node.id === 'payment-service');
        assert.equal(payment.health.status, 'UNREACHABLE');
        assert.equal(payment.health.error, 'CONNECTION_REFUSED');
        assert.equal(graph.healthCheckedAt, '2026-01-01T00:00:00.000Z');
    });

    test('window and limit parsing reject malformed values and clamp limits', () => {
        assert.deepEqual(parseWindow('30s'), { label: '30s', windowMs: 30_000 });
        assert.deepEqual(parseWindow('15m'), { label: '15m', windowMs: 900_000 });
        assert.deepEqual(parseWindow('2h'), { label: '2h', windowMs: 7_200_000 });
        assert.throws(() => parseWindow('forever'), err => err.code === 'INVALID_WINDOW' && err.status === 400);
        assert.throws(() => parseWindow('25h'), err => err.code === 'INVALID_WINDOW');
        assert.equal(parseTraceLimit(undefined), 20);
        assert.equal(parseTraceLimit('999'), 50);
        assert.equal(parseTraceLimit('0'), 1);
    });
});

describe('M-05 ServiceGraphService cache and failure behavior', () => {
    function serviceWith({ listTraces, fetchTrace, healthProbe, now = () => 1_000_000, cacheTtlMs = 1000 }) {
        const tempoClient = {
            listCalls: 0,
            async listTraces(limit, options) {
                this.listCalls += 1;
                this.lastLimit = limit;
                this.lastOptions = options;
                return listTraces(limit, options);
            },
            fetchTrace
        };
        const service = new ServiceGraphService({ tempoClient, healthProbe, cacheTtlMs, now });
        return { service, tempoClient };
    }

    const trace = traceFixture('trace-cache', [
        span('root', null, 'order-service'),
        span('child', 'root', 'payment-service')
    ]);

    test('results are cached with timestamps and refreshed after the TTL', async () => {
        let currentTime = 1_000_000;
        const { service, tempoClient } = serviceWith({
            now: () => currentTime,
            listTraces: async () => [{ traceId: 'trace-cache' }],
            fetchTrace: async () => trace
        });

        const first = await service.getGraph({ window: '5m', limit: 10 });
        assert.equal(first.cache.hit, false);
        assert.equal(first.windowMs, 300_000);
        assert.equal(tempoClient.lastLimit, 10);
        assert.equal(tempoClient.lastOptions.endMs - tempoClient.lastOptions.startMs, 300_000);

        const second = await service.getGraph({ window: '5m', limit: 10 });
        assert.equal(second.cache.hit, true);
        assert.equal(second.generatedAt, first.generatedAt);
        assert.equal(tempoClient.listCalls, 1);

        currentTime += 1001;
        const third = await service.getGraph({ window: '5m', limit: 10 });
        assert.equal(third.cache.hit, false);
        assert.equal(tempoClient.listCalls, 2);
    });

    test('a Tempo outage surfaces as TEMPO_GRAPH_UNAVAILABLE and is not cached', async () => {
        let calls = 0;
        const { service } = serviceWith({
            listTraces: async () => {
                calls += 1;
                throw new TempoError('Tempo is unavailable', { status: 503, code: 'TEMPO_UNAVAILABLE' });
            },
            fetchTrace: async () => trace
        });

        await assert.rejects(
            service.getGraph({ window: '15m' }),
            err => err instanceof TempoError && err.status === 503 && err.code === 'TEMPO_UNAVAILABLE'
        );
        assert.equal(calls, 1);
        assert.equal(service.cache.size, 0);
    });

    test('all trace detail failures produce an explicit unavailable error', async () => {
        const { service } = serviceWith({
            listTraces: async () => [{ traceId: 'trace-1' }, { traceId: 'trace-2' }],
            fetchTrace: async () => {
                throw new TempoError('Tempo returned HTTP 502', { status: 502, code: 'TEMPO_ERROR' });
            }
        });

        await assert.rejects(
            service.getGraph({ window: '15m' }),
            err => err.code === 'TEMPO_GRAPH_UNAVAILABLE' && err.status === 503
        );
    });

    test('no recent traces returns an explicit empty graph instead of a static one', async () => {
        const { service } = serviceWith({
            listTraces: async () => [],
            fetchTrace: async () => trace
        });

        const graph = await service.getGraph({ window: '15m' });
        assert.equal(graph.source, 'tempo');
        assert.equal(graph.traceCount, 0);
        assert.deepEqual(graph.nodes, []);
        assert.deepEqual(graph.edges, []);
        assert.equal(graph.cache.hit, false);
    });

    test('synthetic demo traces are never used to build the production graph', async () => {
        const { service } = serviceWith({
            listTraces: async () => [{ traceId: 'demo-trace' }],
            fetchTrace: async () => ({ ...trace, synthetic: true, source: 'demo' })
        });

        const graph = await service.getGraph({ window: '15m' });
        assert.equal(graph.traceCount, 0);
        assert.deepEqual(graph.edges, []);
    });

    test('scheduler, actuator, and health roots are excluded from the business topology', async () => {
        assert.equal(isInfrastructureTrace({ rootOperation: 'task outboxWorker.scheduledOutboxTick' }), true);
        assert.equal(isInfrastructureTrace({ rootOperation: 'http get /actuator/prometheus' }), true);
        assert.equal(isInfrastructureTrace({ rootOperation: 'GET /health/ready' }), true);
        assert.equal(isInfrastructureTrace({ rootOperation: 'http post /api/orders/checkout' }), false);
        assert.equal(isInfrastructureTrace({ rootOperation: 'POST /api/payments/charge' }), false);
        assert.equal(isInfrastructureTrace({}), false);
    });

    test('detail fetches are bounded instead of overwhelming Tempo', async () => {
        let active = 0;
        let maxActive = 0;
        const items = Array.from({ length: 17 }, (_, index) => index);

        const results = await mapWithConcurrency(items, 3, async (item) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise(resolve => setTimeout(resolve, 5));
            active -= 1;
            return item * 2;
        });

        assert.equal(maxActive <= 3, true, `expected concurrency <= 3, observed ${maxActive}`);
        assert.equal(results.length, items.length);
        assert.deepEqual(results.map(result => result.value), items.map(item => item * 2));
    });

    test('a graph request keeps checkout edges while filtering infrastructure noise', async () => {
        let active = 0;
        let maxActive = 0;
        let seenOptions = null;
        const { service } = serviceWith({
            listTraces: async (limit, options) => {
                seenOptions = options;
                return [
                    { traceId: 'tick', rootOperation: 'task outboxWorker.scheduledOutboxTick' },
                    { traceId: 'scrape', rootOperation: 'http get /actuator/prometheus' },
                    { traceId: 'checkout', rootOperation: 'http post /api/orders/checkout' }
                ];
            },
            fetchTrace: async (traceId) => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                await new Promise(resolve => setTimeout(resolve, 5));
                active -= 1;
                return traceFixture(traceId, [
                    span('root', null, 'order-service'),
                    span('child', 'root', 'payment-service')
                ]);
            }
        });

        const graph = await service.getGraph({ window: '15m', limit: 10 });
        assert.equal(seenOptions.query, BUSINESS_ROOT_QUERY);
        assert.equal(graph.searchQuery, BUSINESS_ROOT_QUERY);
        assert.equal(graph.rawListedTraceCount, 3);
        assert.equal(graph.filteredInfrastructureTraceCount, 2);
        assert.equal(graph.listedTraceCount, 1);
        assert.equal(graph.traceCount, 1);
        assert.equal(graph.failedTraceCount, 0);
        assert.equal(graph.degraded, false);
        assert.equal(maxActive, 1);
        assert.deepEqual(graph.edges.map(edge => `${edge.from}->${edge.to}`), ['order-service->payment-service']);
    });
});
