/**
 * Pure contract adapters shared by the dashboard pages and its regression
 * tests. The dashboard must display exactly what the backends return; these
 * functions never synthesize incidents, metrics, traces, or service health.
 */

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeIncident(raw) {
  if (!raw || typeof raw !== 'object' || !raw.incidentId) {
    return null;
  }

  const primary = raw.primaryRootCause && typeof raw.primaryRootCause === 'object'
    ? raw.primaryRootCause
    : {};

  const confidence = finiteNumber(raw.confidenceScore ?? primary.score);
  const evidence = asArray(raw.evidence).map(item => {
    if (typeof item === 'string') {
      return { type: 'ANALYSIS_SIGNAL', description: item, severity: 'INFO', value: undefined };
    }
    return {
      type: item?.type || 'ANALYSIS_SIGNAL',
      description: item?.description || '',
      severity: item?.severity || 'INFO',
      value: item?.value
    };
  });

  const remediations = asArray(raw.remediations).filter(Boolean);
  if (primary.recommendation && !remediations.includes(primary.recommendation)) {
    remediations.push(primary.recommendation);
  }

  return {
    incidentId: String(raw.incidentId),
    traceId: raw.traceId || null,
    culpritService: raw.culpritService || primary.service || 'unknown',
    rootCauseType: raw.rootCauseType || 'UNKNOWN',
    severity: raw.severity || 'LOW',
    confidenceScore: confidence,
    summary: raw.summary || primary.recommendation || 'No summary recorded for this incident.',
    status: raw.status || 'ACTIVE',
    createdAt: raw.createdAt || raw.analyzedAt || raw.savedAt || null,
    evidence,
    remediations,
    causalPath: asArray(raw.causalPath),
    sweepLineMetrics: raw.sweepLineMetrics || null,
    primaryRootCause: primary,
    metricsAvailable: raw.metricsAvailable !== false,
    metricsError: raw.metricsError || null,
    synthetic: raw.synthetic === true
  };
}

export function normalizeIncidentList(payload) {
  return asArray(payload).map(normalizeIncident).filter(Boolean);
}

export function normalizeMetricsResponse(payload) {
  const servicesObject = payload && typeof payload.services === 'object' && payload.services !== null
    ? payload.services
    : {};
  const services = Object.entries(servicesObject).map(([key, value]) => {
    const available = value?.available === true;
    return {
      service: value?.service || key,
      port: value?.port ?? null,
      available,
      requestRate: available ? finiteNumber(value?.requestRate) : null,
      errorRate: available ? finiteNumber(value?.errorRate) : null,
      p50LatencyMs: available ? finiteNumber(value?.p50LatencyMs) : null,
      p95LatencyMs: available ? finiteNumber(value?.p95LatencyMs) : null,
      p99LatencyMs: available ? finiteNumber(value?.p99LatencyMs) : null,
      status: available ? (value?.status || 'UNKNOWN') : 'UNKNOWN',
      reason: value?.reason || (available ? null : 'NO_METRICS')
    };
  });

  const reporting = services.filter(service => service.available);
  const totalRequestRate = reporting.length
    ? reporting.reduce((sum, service) => sum + (service.requestRate || 0), 0)
    : null;
  const errorRates = reporting
    .map(service => service.errorRate)
    .filter(value => value !== null);
  const averageErrorRate = errorRates.length
    ? errorRates.reduce((sum, value) => sum + value, 0) / errorRates.length
    : null;
  const p99Values = reporting
    .map(service => service.p99LatencyMs)
    .filter(value => value !== null);
  const worstP99LatencyMs = p99Values.length ? Math.max(...p99Values) : null;

  return {
    source: payload?.source || 'prometheus',
    generatedAt: payload?.generatedAt || null,
    window: payload?.window || null,
    services,
    reportingCount: reporting.length,
    totalCount: services.length,
    totalRequestRate,
    averageErrorRate,
    worstP99LatencyMs
  };
}

export function normalizeTracesResponse(payload) {
  return asArray(payload?.traces).map(trace => ({
    traceId: trace?.traceId || trace?.traceID || null,
    rootService: trace?.rootService || 'unknown',
    rootOperation: trace?.rootOperation || 'unknown',
    durationMs: finiteNumber(trace?.durationMs),
    status: trace?.status || 'UNKNOWN',
    startTimeUnixNano: trace?.startTimeUnixNano || null
  })).filter(trace => trace.traceId);
}

export function normalizeTraceDetail(payload) {
  const spans = asArray(payload?.spans);
  if (!spans.length) {
    return {
      traceId: payload?.traceId || null,
      totalSpans: 0,
      totalDurationMs: 0,
      spans: []
    };
  }

  const starts = spans.map(span => Number(span.startMs)).filter(Number.isFinite);
  const minStart = starts.length ? Math.min(...starts) : 0;
  const ends = spans
    .map(span => Number(span.startMs) + Number(span.durationMs))
    .filter(Number.isFinite);
  const maxEnd = ends.length ? Math.max(...ends) : minStart;

  return {
    traceId: payload?.traceId || null,
    totalSpans: Number(payload?.totalSpans ?? spans.length),
    totalDurationMs: Math.max(0, maxEnd - minStart),
    spans: spans
      .map(span => ({
        spanId: span.spanId,
        parentSpanId: span.parentSpanId || null,
        name: span.name || 'unknown',
        service: span.serviceName || 'unknown',
        startOffsetMs: Math.max(0, Number(span.startMs) - minStart),
        durationMs: finiteNumber(span.durationMs) ?? 0,
        selfTimeMs: finiteNumber(span.selfTimeMs) ?? 0,
        statusCode: span.statusCode || 'UNKNOWN',
        statusMessage: span.statusMessage || '',
        timingEngine: span.timingEngine || null,
        attributes: span.attributes && typeof span.attributes === 'object' ? span.attributes : {}
      }))
      .sort((a, b) => a.startOffsetMs - b.startOffsetMs)
  };
}

export function normalizeServiceHealth(payload) {
  return {
    checkedAt: payload?.checkedAt || null,
    upCount: finiteNumber(payload?.upCount),
    totalCount: finiteNumber(payload?.totalCount),
    services: asArray(payload?.services).map(service => ({
      name: service?.name || 'unknown',
      port: service?.port ?? null,
      status: service?.status || 'UNKNOWN',
      httpStatus: service?.httpStatus ?? null,
      latencyMs: finiteNumber(service?.latencyMs),
      detail: service?.detail || null,
      error: service?.error || null
    }))
  };
}

export function paymentFaultPayload({ latencyMs = 0, faultMode = 'NORMAL', errorMessage = null }) {
  return {
    latencyMs: Number(latencyMs) || 0,
    faultMode,
    errorMessage: errorMessage || null
  };
}

export function inventoryFaultPayload({
  latencyMs = 0,
  simulateBusy = false,
  simulateError = false,
  errorMessage = null
}) {
  return {
    LatencyMs: Number(latencyMs) || 0,
    SimulateBusy: Boolean(simulateBusy),
    SimulateError: Boolean(simulateError),
    ErrorMessage: errorMessage || null
  };
}

export function faultResetRequests() {
  return [
    {
      endpoint: '/api/payments/fault',
      body: paymentFaultPayload({ latencyMs: 0, faultMode: 'NORMAL', errorMessage: null })
    },
    {
      endpoint: '/api/inventory/fault',
      body: inventoryFaultPayload({
        latencyMs: 0,
        simulateBusy: false,
        simulateError: false,
        errorMessage: null
      })
    }
  ];
}

export function describeApiError(error) {
  const data = error?.response?.data;
  return {
    status: error?.response?.status ?? null,
    code: data?.code || data?.title || null,
    detail: data?.detail || data?.message || error?.message || 'Request failed',
    traceId: data?.traceId || null
  };
}
