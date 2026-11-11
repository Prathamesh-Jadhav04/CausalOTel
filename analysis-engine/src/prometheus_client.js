/**
 * Prometheus Client for metric queries.
 * Queries Prometheus REST API on port 9090 (or PROMETHEUS_URL).
 *
 * There are no random or hardcoded metric values here. If Prometheus cannot be
 * queried the caller receives a typed error; if Prometheus is reachable but a
 * service has no samples, that service is reported as unavailable.
 */

export class PrometheusError extends Error {
  constructor(message, { status = 503, code = 'PROMETHEUS_UNAVAILABLE', cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PrometheusError';
    this.status = status;
    this.code = code;
  }
}

const SERVICE_CONFIG = [
  { service: 'user-service', job: 'user-service', port: 8081 },
  { service: 'product-service', job: 'product-service', port: 8082 },
  { service: 'order-service', job: 'order-service', port: 8083 },
  { service: 'payment-service', job: 'payment-service', port: 8084 },
  { service: 'inventory-service', job: 'inventory-service', port: 5050 },
  { service: 'analysis-engine', job: 'analysis-engine', port: 5000 }
];

const METRIC_CANDIDATES = [
  {
    count: 'http_server_requests_seconds_count',
    bucket: 'http_server_requests_seconds_bucket',
    statusLabel: 'status'
  },
  {
    count: 'http_server_request_duration_seconds_count',
    bucket: 'http_server_request_duration_seconds_bucket',
    statusLabel: 'http_response_status_code'
  },
  {
    count: 'http_server_duration_count',
    bucket: 'http_server_duration_bucket',
    statusLabel: 'http_status_code'
  }
];

function firstNumericValue(result) {
  if (!Array.isArray(result) || result.length === 0) return null;
  const raw = result[0]?.value?.[1];
  if (raw === undefined || raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export class PrometheusClient {
  constructor(baseUrl = process.env.PROMETHEUS_URL || 'http://localhost:9090', options = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs || parseInt(process.env.PROMETHEUS_TIMEOUT_MS, 10) || 3000;
    this.window = options.window || process.env.PROMETHEUS_WINDOW || '1m';
    this.cacheTtlMs = options.cacheTtlMs ?? 2000;
    this._cache = null;
  }

  async queryMetric(query) {
    let resp;
    try {
      resp = await fetch(`${this.baseUrl}/api/v1/query?query=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (err) {
      throw new PrometheusError('Prometheus is unavailable', {
        status: 503,
        code: 'PROMETHEUS_UNAVAILABLE',
        cause: err
      });
    }

    if (!resp.ok) {
      if (resp.status >= 500) {
        throw new PrometheusError(`Prometheus returned HTTP ${resp.status}`, {
          status: 503,
          code: 'PROMETHEUS_UNAVAILABLE'
        });
      }
      throw new PrometheusError(`Prometheus rejected the query (HTTP ${resp.status})`, {
        status: 502,
        code: 'PROMETHEUS_QUERY_ERROR'
      });
    }

    let data;
    try {
      data = await resp.json();
    } catch (err) {
      throw new PrometheusError('Prometheus returned malformed JSON', {
        status: 502,
        code: 'PROMETHEUS_INVALID_RESPONSE',
        cause: err
      });
    }

    if (data?.status !== 'success') {
      throw new PrometheusError('Prometheus query did not succeed', {
        status: 502,
        code: 'PROMETHEUS_QUERY_ERROR'
      });
    }

    return data?.data?.result || [];
  }

  async _selectMetricVariant(job) {
    for (const candidate of METRIC_CANDIDATES) {
      const query = `sum(rate(${candidate.count}{job="${job}"}[${this.window}]))`;
      const result = await this.queryMetric(query);
      if (firstNumericValue(result) !== null) {
        return candidate;
      }
    }
    return null;
  }

  async _serviceMetrics(config) {
    const variant = await this._selectMetricVariant(config.job);
    if (!variant) {
      return {
        service: config.service,
        port: config.port,
        available: false,
        reason: 'NO_METRICS',
        status: 'UNKNOWN'
      };
    }

    const job = config.job;
    const rateExpr = `sum(rate(${variant.count}{job="${job}"}[${this.window}]))`;
    const errorExpr = `sum(rate(${variant.count}{job="${job}",${variant.statusLabel}=~"5.."}[${this.window}]))`;
    const errorRateExpr = `(${errorExpr}) / clamp_min(${rateExpr}, 0.000001)`;
    const quantile = (q) =>
      `histogram_quantile(${q}, sum by (le) (rate(${variant.bucket}{job="${job}"}[${this.window}]))) * 1000`;

    const [requestRateResult, errorRateResult, p50Result, p95Result, p99Result] = await Promise.all([
      this.queryMetric(rateExpr),
      this.queryMetric(errorRateExpr),
      this.queryMetric(quantile(0.50)),
      this.queryMetric(quantile(0.95)),
      this.queryMetric(quantile(0.99))
    ]);

    const requestRate = firstNumericValue(requestRateResult);
    const errorRate = firstNumericValue(errorRateResult) ?? 0;
    const p50 = firstNumericValue(p50Result);
    const p95 = firstNumericValue(p95Result);
    const p99 = firstNumericValue(p99Result);

    const status = (errorRate > 0.05 || (p95 ?? 0) > 500) ? 'DEGRADED' : 'HEALTHY';

    return {
      service: config.service,
      port: config.port,
      available: true,
      requestRate: Number(requestRate.toFixed(2)),
      errorRate: Number(errorRate.toFixed(4)),
      p50LatencyMs: p50 === null ? null : Number(p50.toFixed(1)),
      p95LatencyMs: p95 === null ? null : Number(p95.toFixed(1)),
      p99LatencyMs: p99 === null ? null : Number(p99.toFixed(1)),
      status
    };
  }

  async getServiceMetrics({ useCache = true } = {}) {
    if (useCache && this._cache && (Date.now() - this._cache.at) < this.cacheTtlMs) {
      return this._cache.value;
    }

    const entries = await Promise.all(
      SERVICE_CONFIG.map(async config => {
        try {
          return [config.service, await this._serviceMetrics(config)];
        } catch (err) {
          if (err instanceof PrometheusError && err.status === 503) {
            throw err;
          }
          return [config.service, {
            service: config.service,
            port: config.port,
            available: false,
            reason: 'QUERY_ERROR',
            status: 'UNKNOWN'
          }];
        }
      })
    );

    const value = {
      source: 'prometheus',
      generatedAt: new Date().toISOString(),
      window: this.window,
      services: Object.fromEntries(entries)
    };

    this._cache = { at: Date.now(), value };
    return value;
  }
}

export default PrometheusClient;
