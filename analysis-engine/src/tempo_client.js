/**
 * Tempo Distributed Trace Client.
 * Queries Tempo HTTP API on port 3200 (or configured TEMPO_URL), normalizes span hierarchy,
 * and executes Sweep-Line interval union to calculate true span self-times.
 */

import { computeIntervalUnion } from './cpp_bridge.js';

export class TempoClient {
  constructor(baseUrl = process.env.TEMPO_URL || 'http://localhost:3200') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async fetchTrace(traceId) {
    const url = `${this.baseUrl}/api/traces/${traceId}`;
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(3000)
      });

      if (!response.ok) {
        throw new Error(`Tempo returned HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return this.normalizeTrace(data);
    } catch (err) {
      // In standalone test or demo without running Tempo container, generate synthesized trace
      return this.synthesizeTraceForDemo(traceId, err.message);
    }
  }

  normalizeTrace(rawTempoData) {
    const flatSpans = [];

    // Parse OTLP/Tempo JSON batches
    const batches = rawTempoData.batches || [];
    for (const batch of batches) {
      const serviceName = batch.resource?.attributes?.find(a => a.key === 'service.name')?.value?.stringValue || 'unknown-service';
      const scopeSpans = batch.scopeSpans || batch.instrumentationLibrarySpans || [];

      for (const scope of scopeSpans) {
        const spans = scope.spans || [];
        for (const s of spans) {
          const startNano = BigInt(s.startTimeUnixNano || s.startTimeNano || 0);
          const endNano = BigInt(s.endTimeUnixNano || s.endTimeNano || startNano);
          const durationMs = Number(endNano - startNano) / 1_000_000;

          const attributes = {};
          if (Array.isArray(s.attributes)) {
            for (const attr of s.attributes) {
              const val = attr.value?.stringValue || attr.value?.intValue || attr.value?.boolValue || attr.value?.doubleValue || JSON.stringify(attr.value);
              attributes[attr.key] = val;
            }
          }

          flatSpans.push({
            traceId: s.traceId,
            spanId: s.spanId,
            parentSpanId: s.parentSpanId || null,
            name: s.name,
            serviceName,
            kind: s.kind || 'SPAN_KIND_INTERNAL',
            startNano: startNano.toString(),
            endNano: endNano.toString(),
            startMs: Number(startNano / 1_000_000n),
            endMs: Number(endNano / 1_000_000n),
            durationMs: Math.max(0, durationMs),
            statusCode: s.status?.code === 2 || s.status?.code === 'STATUS_CODE_ERROR' ? 'ERROR' : 'OK',
            statusMessage: s.status?.message || '',
            attributes
          });
        }
      }
    }

    return this.buildSpanTreeAndSelfTimes(flatSpans);
  }

  buildSpanTreeAndSelfTimes(flatSpans) {
    const spanMap = new Map();
    const childrenMap = new Map();

    for (const span of flatSpans) {
      spanMap.set(span.spanId, { ...span, children: [] });
      if (!childrenMap.has(span.spanId)) {
        childrenMap.set(span.spanId, []);
      }
      if (span.parentSpanId) {
        if (!childrenMap.has(span.parentSpanId)) {
          childrenMap.set(span.parentSpanId, []);
        }
        childrenMap.get(span.parentSpanId).push(span.spanId);
      }
    }

    // Compute sweep-line self times
    for (const [spanId, span] of spanMap.entries()) {
      const childIds = childrenMap.get(spanId) || [];
      const childIntervals = childIds.map(cid => {
        const c = spanMap.get(cid);
        return { start: c.startMs, end: c.endMs };
      });

      const sweep = computeIntervalUnion(
        { start: span.startMs, end: span.endMs },
        childIntervals
      );

      span.selfTimeMs = sweep.selfTime;
      span.childUnionDurationMs = sweep.childUnionDuration;
      span.mergedChildIntervals = sweep.mergedIntervals;
      span.timingEngine = sweep.engine;
    }

    // Link tree hierarchy
    const rootSpans = [];
    for (const span of spanMap.values()) {
      if (!span.parentSpanId || !spanMap.has(span.parentSpanId)) {
        rootSpans.push(span);
      } else {
        const parent = spanMap.get(span.parentSpanId);
        parent.children.push(span);
      }
    }

    return {
      traceId: flatSpans[0]?.traceId || 'unknown',
      totalSpans: flatSpans.length,
      rootSpans,
      spans: Array.from(spanMap.values())
    };
  }

  synthesizeTraceForDemo(traceId, reason = 'Tempo offline') {
    const baseTime = Date.now() - 60000;
    const spans = [
      {
        traceId,
        spanId: 'span-root-order',
        parentSpanId: null,
        name: 'POST /api/orders/checkout',
        serviceName: 'order-service',
        kind: 'SPAN_KIND_SERVER',
        startMs: baseTime,
        endMs: baseTime + 3250,
        durationMs: 3250,
        statusCode: 'ERROR',
        statusMessage: 'Payment processing failed: 504 Gateway Timeout',
        attributes: { 'http.status_code': 500, 'order.id': 'ord-demo-123' }
      },
      {
        traceId,
        spanId: 'span-inv-res',
        parentSpanId: 'span-root-order',
        name: 'POST /api/inventory/reserve',
        serviceName: 'inventory-service',
        kind: 'SPAN_KIND_CLIENT',
        startMs: baseTime + 50,
        endMs: baseTime + 180,
        durationMs: 130,
        statusCode: 'OK',
        statusMessage: '',
        attributes: { 'http.status_code': 200 }
      },
      {
        traceId,
        spanId: 'span-pay-charge',
        parentSpanId: 'span-root-order',
        name: 'POST /api/payments/charge',
        serviceName: 'payment-service',
        kind: 'SPAN_KIND_CLIENT',
        startMs: baseTime + 200,
        endMs: baseTime + 3210,
        durationMs: 3010,
        statusCode: 'ERROR',
        statusMessage: 'Gateway Timeout (Simulated Downstream Failure)',
        attributes: { 'http.status_code': 504, 'payment.gateway': 'SIMULATED' }
      },
      {
        traceId,
        spanId: 'span-inv-comp-rel',
        parentSpanId: 'span-root-order',
        name: 'POST /api/inventory/release',
        serviceName: 'inventory-service',
        kind: 'SPAN_KIND_CLIENT',
        startMs: baseTime + 3215,
        endMs: baseTime + 3245,
        durationMs: 30,
        statusCode: 'OK',
        statusMessage: '',
        attributes: { 'http.status_code': 200 }
      }
    ];

    const tree = this.buildSpanTreeAndSelfTimes(spans);
    tree.offlineNotice = reason;
    return tree;
  }
}

export default TempoClient;
