import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  BarChart3,
  Clock,
  Database,
  RefreshCw,
  TrendingUp
} from 'lucide-react';
import api from '../lib/api.js';
import { describeApiError, normalizeMetricsResponse } from '../lib/contracts.js';
import {
  Badge,
  Button,
  Chip,
  EmptyState,
  ErrorBanner,
  GlassCard,
  MetaChip,
  Meter,
  PageHeader,
  StatCard,
  StatusBadge,
  cn
} from '../components/ui.jsx';

function formatLatency(value) {
  return value === null || value === undefined ? '—' : `${value} ms`;
}

function formatRate(value) {
  return value === null || value === undefined ? '—' : value.toFixed(2);
}

function formatPercent(value) {
  return value === null || value === undefined ? '—' : `${(value * 100).toFixed(2)}%`;
}

function MetricTile({ label, value, accent }) {
  return (
    <div className="rounded-lg border border-white/[0.055] bg-inset p-2.5">
      <p className="text-[9px] text-white/40">{label}</p>
      <p className={cn('mt-1 font-mono text-[12px] font-semibold', accent || 'text-white/74')}>{value}</p>
    </div>
  );
}

export default function Metrics() {
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState(null);
  const [selectedService, setSelectedService] = useState('ALL');
  const [sortBy, setSortBy] = useState('name');
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
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
      setLastLoadedAt(new Date());
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const services = metrics?.services || [];
  const displayedMetrics = selectedService === 'ALL'
    ? services
    : services.filter(service => service.service === selectedService);
  const sortedMetrics = [...displayedMetrics].sort((a, b) => {
    if (sortBy === 'p99') return (Number(b.p99LatencyMs) || 0) - (Number(a.p99LatencyMs) || 0);
    if (sortBy === 'errors') return (Number(b.errorRate) || 0) - (Number(a.errorRate) || 0);
    if (sortBy === 'traffic') return (Number(b.requestRate) || 0) - (Number(a.requestRate) || 0);
    return a.service.localeCompare(b.service);
  });
  const maxP99 = Math.max(
    1,
    ...displayedMetrics
      .filter(service => service.available)
      .map(service => Number(service.p99LatencyMs) || 0)
  );
  const maxRate = Math.max(
    0.01,
    ...displayedMetrics
      .filter(service => service.available)
      .map(service => Number(service.requestRate) || 0)
  );

  return (
    <div className="space-y-5 lg:space-y-6">
      <PageHeader
        eyebrow="Prometheus signals"
        title="System metrics"
        description="Live PromQL results from Prometheus. Services without samples are shown as unavailable, never estimated."
        actions={
          <Button onClick={load} loading={loading} variant="secondary">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            {loading ? 'Refreshing' : 'Refresh metrics'}
          </Button>
        }
        meta={metrics ? (
          <>
            <MetaChip icon={Database}>source: {metrics.source}</MetaChip>
            <MetaChip icon={Clock}>window: {metrics.window || '—'}</MetaChip>
            <MetaChip>{metrics.generatedAt ? new Date(metrics.generatedAt).toLocaleString() : 'not generated'}</MetaChip>
            {lastLoadedAt && <MetaChip>loaded {lastLoadedAt.toLocaleTimeString()}</MetaChip>}
          </>
        ) : null}
      />

      {error && (
        <ErrorBanner
          title="Prometheus unavailable"
          detail={error.detail}
          code={error.code || 'PROMETHEUS_UNAVAILABLE'}
        >
          <div className="mt-1 text-[10px] text-rose-200/55">
            Start Prometheus and verify the scrape targets before trusting any metric view.
          </div>
        </ErrorBanner>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard
          label="Reporting services"
          value={metrics ? `${metrics.reportingCount} / ${metrics.totalCount}` : '—'}
          hint="Services with real Prometheus samples"
          icon={Database}
          tone="emerald"
        />
        <StatCard
          label="Total throughput"
          value={formatRate(metrics?.totalRequestRate)}
          suffix="req/s"
          hint="Sum of reporting services"
          icon={TrendingUp}
          tone="signal"
        />
        <StatCard
          label="Average error rate"
          value={formatPercent(metrics?.averageErrorRate)}
          hint="Mean of reporting services"
          icon={AlertTriangle}
          tone={metrics?.averageErrorRate > 0.05 ? 'rose' : 'emerald'}
          valueClassName={metrics?.averageErrorRate > 0.05 ? 'text-rose-300' : 'text-emerald-300'}
        />
        <StatCard
          label="Worst P99 latency"
          value={formatLatency(metrics?.worstP99LatencyMs)}
          hint="Highest P99 among reporting services"
          icon={Clock}
          tone={metrics?.worstP99LatencyMs > 500 ? 'amber' : 'neutral'}
        />
      </div>

      {metrics && services.length > 0 && (
        <GlassCard className="p-3.5 sm:p-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 font-medium uppercase text-[10px] tracking-[0.045em] text-ink-subtle">Filter service</span>
              <Chip active={selectedService === 'ALL'} onClick={() => setSelectedService('ALL')}>
                All services
              </Chip>
              {services.map((service) => (
                <Chip
                  key={service.service}
                  active={selectedService === service.service}
                  onClick={() => setSelectedService(service.service)}
                  className="font-mono"
                >
                  {service.service}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.065] pt-3">
              <span className="mr-1 inline-flex items-center gap-1.5 font-mono text-[9px] font-medium uppercase tracking-[0.08em] text-white/42">
                <ArrowUpDown className="h-3.5 w-3.5" />
                Sort
              </span>
              <Chip active={sortBy === 'name'} onClick={() => setSortBy('name')}>Name</Chip>
              <Chip active={sortBy === 'p99'} onClick={() => setSortBy('p99')}>P99 latency</Chip>
              <Chip active={sortBy === 'errors'} onClick={() => setSortBy('errors')}>Error rate</Chip>
              <Chip active={sortBy === 'traffic'} onClick={() => setSortBy('traffic')}>Traffic</Chip>
            </div>
          </div>
        </GlassCard>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 lg:gap-4">
        {sortedMetrics.map((service, index) => (
          <GlassCard
            key={service.service}
            interactive
            className={cn('flex flex-col p-4 sm:p-5', index < 3 ? 'stagger-1' : 'stagger-2', 'animate-fade-up')}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-all font-mono text-[13px] font-semibold text-white/88">{service.service}</h2>
                <p className="mt-0.5 font-mono text-[10px] text-white/40">
                  {service.port === null ? 'port unknown' : `Port :${service.port}`}
                </p>
              </div>
              <StatusBadge status={service.available ? service.status : 'UNAVAILABLE'} />
            </div>

            {!service.available ? (
              <div className="mt-4 rounded-lg border border-amber-400/15 bg-amber-400/[0.045] p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-200">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  No metric samples
                </div>
                <p className="mt-1 break-all font-mono text-[10px] text-white/40">reason: {service.reason || 'NO_METRICS'}</p>
              </div>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <MetricTile label="Request rate" value={`${formatRate(service.requestRate)} req/s`} accent="text-white/78" />
                  <MetricTile
                    label="Error rate"
                    value={formatPercent(service.errorRate)}
                    accent={service.errorRate > 0 ? 'text-rose-300' : 'text-emerald-300'}
                  />
                  <MetricTile label="P50 latency" value={formatLatency(service.p50LatencyMs)} />
                  <MetricTile label="P95 latency" value={formatLatency(service.p95LatencyMs)} />
                  <MetricTile
                    label="P99 latency"
                    value={formatLatency(service.p99LatencyMs)}
                    accent={service.p99LatencyMs > 500 ? 'text-amber-300' : 'text-white/78'}
                  />
                  <MetricTile label="Status" value={service.status} accent="text-emerald-300" />
                </div>

                <div className="mt-4 space-y-3">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-[9px] text-white/40">
                      <span>Request volume</span>
                      <span className="font-mono text-white/50">{formatRate(service.requestRate)} req/s</span>
                    </div>
                    <Meter value={service.requestRate} max={maxRate} tone="signal" />
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-[9px] text-white/40">
                      <span>P99 relative to worst</span>
                      <span className="font-mono text-white/50">{formatLatency(service.p99LatencyMs)}</span>
                    </div>
                    <Meter value={service.p99LatencyMs} max={maxP99} tone={service.p99LatencyMs > 500 ? 'amber' : 'sky'} />
                  </div>
                </div>
              </>
            )}

            <div className="mt-auto flex items-center justify-between border-t border-white/[0.06] pt-3 text-[10px] text-white/36">
              <span>Source</span>
              <span className="font-mono text-white/54">Prometheus</span>
            </div>
          </GlassCard>
        ))}
      </div>

      {!loading && !error && services.length === 0 && (
        <EmptyState
          icon={BarChart3}
          title="No services reported"
          description="Prometheus returned an empty service set."
          className="py-16"
        />
      )}

      {metrics && displayedMetrics.length === 0 && services.length > 0 && (
        <EmptyState
          icon={BarChart3}
          title="No metrics for this service"
          description="Select another service or clear the filter."
          className="py-12"
        />
      )}

      <div className="flex flex-wrap items-center gap-2 text-[10px] text-white/32">
        <Badge tone="signal" dot>LIVE PROMQL</Badge>
        Values are rendered exactly as returned; unavailable samples are never estimated.
      </div>
    </div>
  );
}
