/**
 * Tempo Distributed Trace Client.
 * Queries Tempo HTTP API on port 3200 (or configured TEMPO_URL), normalizes span hierarchy,
 * and executes Sweep-Line interval union to calculate true span self-times.
 *
 * Tempo failures are never converted into synthetic traces on the normal path.
 * Callers receive a typed TempoError with a machine-readable code so the API can
 * return 404 (unknown trace) or 502/503 (Tempo unavailable/invalid response).
 */

import { computeIntervalUnion } from './cpp_bridge.js';

export class TempoError extends Error {
  constructor(message, { status = 502, code = 'TEMPO_ERROR', cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'TempoError';
    this.status = status;
    this.code = code;
  }
}

const TRACE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function validateTraceId(traceId) {
  if (typeof traceId !== 'string' || traceId.length === 0) {
    throw new TempoError('traceId is required', { status: 400, code: 'INVALID_TRACE_ID' });
  }
  if (traceId.length > 128 || !TRACE_ID_PATTERN.test(traceId)) {
    throw new TempoError('traceId has an invalid format', { status: 400, code: 'INVALID_TRACE_ID' });
  }
  return traceId;
}

export class TempoClient {
  constructor(baseUrl = process.env.TEMPO_URL || 'http://localhost:3200', options = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs || parseInt(process.env.TEMPO_TIMEOUT_MS, 10) || 3000;
  }

  async _request(pathname) {
    let response;
    try {
      response = await fetch(`${this.baseUrl}${pathname}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (err) {
      const code = err?.name === 'TimeoutError' || err?.name === 'AbortError'
        ? 'TEMPO_TIMEOUT'
        : 'TEMPO_UNAVAILABLE';
      throw new TempoError(
        code === 'TEMPO_TIMEOUT' ? 'Tempo request timed out' : 'Tempo is unavailable',
        { status: 503, code, cause: err }
      );
    }

    if (response.status === 404) {
      throw new TempoError('Trace not found', { status: 404, code: 'TRACE_NOT_FOUND' });
    }
    if (response.status === 400) {
      throw new TempoError('Tempo rejected the trace request', { status: 400, code: 'INVALID_TRACE_ID' });
    }
    if (!response.ok) {
      throw new TempoError(`Tempo returned HTTP ${response.status}`, {
        status: 502,
        code: 'TEMPO_ERROR'
      });
    }

    try {
      return await response.json();
    } catch (err) {
      throw new TempoError('Tempo returned malformed JSON', {
        status: 502,
        code: 'TEMPO_INVALID_RESPONSE',
        cause: err
      });
    }
  }

  async fetchTrace(traceId) {
    const safeTraceId = validateTraceId(traceId);
    const data = await this._request(`/api/traces/${encodeURIComponent(safeTraceId)}`);
    const trace = this.normalizeTrace(data);

    if (!trace.spans.length) {
      throw new TempoError('Trace contains no spans', { status: 404, code: 'TRACE_NOT_FOUND' });
    }

    return {
      ...trace,
      synthetic: false,
      source: 'tempo'
    };
  }

  /**
   * Search recent traces. Tempo's search API is the only trace-list source;
   * when Tempo is down this throws rather than returning fabricated rows.
   */
  async listTraces(limit = 20, options = {}) {
    const boundedLimit = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 20));
    let pathname = `/api/search?limit=${boundedLimit}`;
    // Tempo's search API accepts unix-second bounds. Passing them keeps the
    // M-05 topology graph scoped to the caller's requested window.
    if (Number.isFinite(options.startMs)) {
      pathname += `&start=${Math.floor(options.startMs / 1000)}`;
    }
    if (Number.isFinite(options.endMs)) {
      pathname += `&end=${Math.floor(options.endMs / 1000)}`;
    }
    const data = await this._request(pathname);
    const traces = Array.isArray(data?.traces) ? data.traces : [];

    return traces.map(t => ({
      traceId: t.traceID || t.traceId,
      rootService: t.rootServiceName || 'unknown',
      rootOperation: t.rootTraceName || 'unknown',
      startTimeUnixNano: t.startTimeUnixNano || null,
      durationMs: Number(t.durationMs) || 0,
      status: t.status || 'UNKNOWN'
    }));
  }

  normalizeTrace(rawTempoData) {
    const flatSpans = [];

    // Parse OTLP/Tempo JSON batches
    const batches = rawTempoData?.batches || [];
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
              const val = attr.value?.stringValue ?? attr.value?.intValue ?? attr.value?.boolValue ?? attr.value?.doubleValue ?? JSON.stringify(attr.value);
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

  /**
   * Explicitly opt-in demo fixture. This is never used by fetchTrace and must
   * never be persisted as a real incident or fed into RCA scoring.
   */
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
    return {
      ...tree,
      synthetic: true,
      source: 'demo',
      syntheticReason: reason,
      offlineNotice: reason
    };
  }
}

export default TempoClient;
