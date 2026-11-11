import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  Activity,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  TrendingUp,
  Clock,
  Database
} from 'lucide-react';
import api from '../lib/api.js';
import { describeApiError, normalizeMetricsResponse } from '../lib/contracts.js';

function formatLatency(value) {
  return value === null || value === undefined ? '—' : `${value} ms`;
}

function formatRate(value) {
  return value === null || value === undefined ? '—' : value.toFixed(2);
}

function formatPercent(value) {
  return value === null || value === undefined ? '—' : `${(value * 100).toFixed(2)}%`;
}

export default function Metrics() {
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState(null);
  const [selectedService, setSelectedService] = useState('ALL');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/analysis/metrics');
      setMetrics(normalizeMetricsResponse(response.data));
      setError(null);
    } catch (err) {
      setMetrics(null);
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const services = metrics?.services || [];
  const displayedMetrics = selectedService === 'ALL'
    ? services
    : services.filter(service => service.service === selectedService);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight">System Metrics</h2>
          <p className="text-sm text-slate-400 mt-1">
            Live PromQL results from Prometheus. Services without samples are shown as unavailable, never estimated.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Refreshing...' : 'Refresh Metrics'}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/30 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Prometheus unavailable ({error.code || 'PROMETHEUS_UNAVAILABLE'})</div>
            <div className="mt-1">{error.detail}</div>
            <div className="mt-1 text-rose-400/80">
              Start Prometheus and verify the scrape targets before trusting any metric view.
            </div>
          </div>
        </div>
      )}

      {metrics && (
        <div className="flex items-center gap-4 text-xs text-slate-400 font-mono">
          <span>source: {metrics.source}</span>
          <span>window: {metrics.window || '—'}</span>
          <span>generated: {metrics.generatedAt ? new Date(metrics.generatedAt).toLocaleString() : '—'}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Reporting Services</div>
          <div className="text-2xl font-bold text-slate-100 mt-2 flex items-baseline gap-1.5">
            <span>{metrics ? `${metrics.reportingCount} / ${metrics.totalCount}` : '—'}</span>
          </div>
          <div className="text-xs text-slate-400 mt-2 flex items-center gap-1">
            <Database className="w-3.5 h-3.5" />
            Services with real Prometheus samples
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Throughput</div>
          <div className="text-2xl font-bold text-slate-100 mt-2 flex items-baseline gap-1.5">
            <span>{formatRate(metrics?.totalRequestRate)}</span>
            <span className="text-xs text-slate-400 font-normal">req/s</span>
          </div>
          <div className="text-xs text-slate-400 mt-2 flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" />
            Sum of reporting services
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Average Error Rate</div>
          <div className={`text-2xl font-bold mt-2 ${
            metrics?.averageErrorRate > 0.05 ? 'text-rose-400' : 'text-emerald-400'
          }`}>
            {formatPercent(metrics?.averageErrorRate)}
          </div>
          <div className="text-xs text-slate-400 mt-2">
            Mean of reporting services
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Worst P99 Latency</div>
          <div className={`text-2xl font-bold mt-2 ${
            metrics?.worstP99LatencyMs > 500 ? 'text-amber-400' : 'text-slate-100'
          }`}>
            {formatLatency(metrics?.worstP99LatencyMs)}
          </div>
          <div className="text-xs text-slate-400 mt-2 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            Highest P99 among reporting services
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <span className="text-xs text-slate-400 font-medium whitespace-nowrap">Filter Service:</span>
        <button
          onClick={() => setSelectedService('ALL')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            selectedService === 'ALL'
              ? 'bg-indigo-600 text-white shadow'
              : 'bg-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          All Services
        </button>
        {services.map((service) => (
          <button
            key={service.service}
            onClick={() => setSelectedService(service.service)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium font-mono whitespace-nowrap transition ${
              selectedService === service.service
                ? 'bg-indigo-600 text-white shadow'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {service.service}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {displayedMetrics.map((service) => (
          <div
            key={service.service}
            className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition shadow-sm space-y-4"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-mono font-semibold text-slate-100 text-base">{service.service}</h3>
                <span className="text-xs text-indigo-400 font-mono">
                  {service.port === null ? 'port unknown' : `Port :${service.port}`}
                </span>
              </div>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  !service.available
                    ? 'bg-slate-800 border border-slate-700 text-slate-400'
                    : service.status === 'HEALTHY'
                      ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-300'
                      : 'bg-rose-950/80 border border-rose-800 text-rose-300'
                }`}
              >
                {service.available ? service.status : 'UNAVAILABLE'}
              </span>
            </div>

            {!service.available ? (
              <div className="py-4 border-y border-slate-800 text-xs text-slate-400 space-y-1">
                <div className="flex items-center gap-1.5 text-amber-400 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  No metric samples
                </div>
                <div className="font-mono text-[11px] text-slate-500">reason: {service.reason || 'NO_METRICS'}</div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 py-3 border-y border-slate-800 text-xs">
                <div>
                  <div className="text-slate-500">Request rate</div>
                  <div className="text-slate-200 font-semibold font-mono text-sm mt-0.5">
                    {formatRate(service.requestRate)} req/s
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Error rate</div>
                  <div className={`font-semibold font-mono text-sm mt-0.5 ${
                    service.errorRate > 0 ? 'text-rose-400' : 'text-emerald-400'
                  }`}>
                    {formatPercent(service.errorRate)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">P50 latency</div>
                  <div className="text-slate-300 font-mono mt-0.5">{formatLatency(service.p50LatencyMs)}</div>
                </div>
                <div>
                  <div className="text-slate-500">P95 latency</div>
                  <div className="text-slate-300 font-mono mt-0.5">{formatLatency(service.p95LatencyMs)}</div>
                </div>
                <div>
                  <div className="text-slate-500">P99 latency</div>
                  <div className={`font-mono font-semibold mt-0.5 ${
                    service.p99LatencyMs > 500 ? 'text-amber-400' : 'text-slate-300'
                  }`}>
                    {formatLatency(service.p99LatencyMs)}
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Source</span>
              <span className="font-mono text-slate-300">Prometheus</span>
            </div>
          </div>
        ))}
      </div>

      {!loading && !error && services.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400">
          <BarChart3 className="w-8 h-8 text-slate-500 mx-auto mb-2" />
          <p className="text-base font-medium text-slate-300">No services reported</p>
          <p className="text-xs text-slate-500 mt-1">Prometheus returned an empty service set.</p>
        </div>
      )}
    </div>
  );
}
