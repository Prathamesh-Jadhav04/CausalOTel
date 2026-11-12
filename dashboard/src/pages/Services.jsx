import React, { useEffect, useState } from 'react';
import { Database, RefreshCw, Server, Terminal } from 'lucide-react';
import api from '../lib/api.js';
import { describeApiError, normalizeServiceHealth } from '../lib/contracts.js';
import {
  Badge,
  Button,
  ErrorBanner,
  GlassCard,
  MetaChip,
  PageHeader,
  StatusBadge,
  cn
} from '../components/ui.jsx';

const serviceMetadata = [
  {
    name: 'user-service',
    runtime: 'Java 25 (Spring Boot 4.0)',
    port: 8081,
    db: 'SQLite (user.db)',
    health: '/health/live',
    metrics: '/actuator/prometheus',
    description: 'Issues signed bearer tokens, manages identities, and provisions the one-time administrator.'
  },
  {
    name: 'product-service',
    runtime: 'Java 25 (Spring Boot 4.0)',
    port: 8082,
    db: 'SQLite (product.db)',
    health: '/health/live',
    metrics: '/actuator/prometheus',
    description: 'Authoritative product catalog and price source for checkout.'
  },
  {
    name: 'order-service',
    runtime: 'Java 25 (Spring Boot 4.0)',
    port: 8083,
    db: 'SQLite (order.db)',
    health: '/health/live',
    metrics: '/actuator/prometheus',
    description: 'Saga orchestrator with transactional outbox, leases, and compensation.'
  },
  {
    name: 'payment-service',
    runtime: 'Java 25 (Spring Boot 4.0)',
    port: 8084,
    db: 'SQLite (payment.db)',
    health: '/health/live',
    metrics: '/actuator/prometheus',
    description: 'Simulated payment gateway with idempotency and refund invariants.'
  },
  {
    name: 'inventory-service',
    runtime: '.NET 10 (ASP.NET Core Web API)',
    port: 5050,
    db: 'SQLite (inventory.db)',
    health: '/health/live',
    metrics: '/metrics',
    description: 'Atomic stock reservation engine with TTL expiry and a state machine.'
  },
  {
    name: 'analysis-engine',
    runtime: 'Node.js 26 (Express 5)',
    port: 5000,
    db: 'Durable disk spool',
    health: '/health/live',
    metrics: '/metrics',
    description: 'Tempo trace consumer, Prometheus correlator, RCA engine, and incident store.'
  }
];

export default function Services() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/analysis/services');
      setHealth(normalizeServiceHealth(response.data));
      setError(null);
    } catch (err) {
      setHealth(null);
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byName = new Map((health?.services || []).map(service => [service.name, service]));

  return (
    <div className="space-y-5 lg:space-y-6">
      <PageHeader
        eyebrow="Service registry"
        title="Microservices topology"
        description="Live /health/live probes from the analysis engine; statuses are never hardcoded."
        actions={
          <Button onClick={load} loading={loading} variant="secondary">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            {loading ? 'Probing' : 'Probe services'}
          </Button>
        }
        meta={
          <>
            <MetaChip icon={Server}>{serviceMetadata.length} registered services</MetaChip>
            <MetaChip icon={Terminal}>{health ? `${health.upCount}/${health.totalCount} reporting UP` : 'Awaiting probe'}</MetaChip>
          </>
        }
      />

      {error && (
        <ErrorBanner title="Health probe failed" detail={error.detail} code={error.code} />
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 lg:gap-4">
        {serviceMetadata.map((svc, index) => {
          const live = byName.get(svc.name);
          const status = live?.status || (error ? 'UNKNOWN' : loading ? 'CHECKING' : 'NOT_REPORTED');
          return (
            <GlassCard
              key={svc.name}
              interactive
              className={cn('relative flex flex-col overflow-hidden p-4 sm:p-5', index < 4 ? 'stagger-1' : 'stagger-2', 'animate-fade-up')}
            >
              <div
                className={cn(
                  'pointer-events-none absolute inset-x-0 top-0 h-px',
                  status === 'UP'
                    ? 'bg-gradient-to-r from-transparent via-emerald-400/50 to-transparent'
                    : status === 'DOWN'
                      ? 'bg-gradient-to-r from-transparent via-amber-400/50 to-transparent'
                      : 'bg-gradient-to-r from-transparent via-white/15 to-transparent'
                )}
              />

              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-gradient-to-br from-white/[0.08] to-white/[0.02] text-white/64">
                    <Server className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate font-mono text-[13px] font-semibold text-white/90">{svc.name}</h2>
                    <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-white/40">Service</p>
                  </div>
                </div>
                <StatusBadge status={status} />
              </div>

              <p className="mt-3 text-[11px] leading-relaxed text-white/50">{svc.description}</p>

              <dl className="mt-4 space-y-2 border-t border-white/[0.06] pt-3 text-[11px]">
                <div className="flex items-start justify-between gap-3">
                  <dt className="shrink-0 text-white/40">Runtime</dt>
                  <dd className="min-w-0 break-words text-right font-mono text-[10px] leading-relaxed text-white/64">{svc.runtime}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-white/40">Host port</dt>
                  <dd className="font-mono font-semibold text-signal-300">:{svc.port}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-white/40">Storage</dt>
                  <dd className="flex min-w-0 items-center gap-1.5 text-white/62">
                    <Database className="h-3 w-3 shrink-0 text-white/40" />
                    <span className="truncate">{svc.db}</span>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-white/40">Probe latency</dt>
                  <dd className="font-mono text-white/64">
                    {live?.latencyMs === null || live?.latencyMs === undefined ? '—' : `${live.latencyMs}ms`}
                  </dd>
                </div>
              </dl>

              <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] pt-3">
                <MetaChip>{svc.health}</MetaChip>
                <MetaChip>{svc.metrics}</MetaChip>
              </div>
            </GlassCard>
          );
        })}
      </div>

      <GlassCard className="flex items-start gap-3 p-4 text-[11px] leading-relaxed text-white/44">
        <Badge tone="signal" dot>LIVE</Badge>
        <p className="min-w-0">
          Every card is rendered from the service registry and the latest probe payload. Missing services are shown
          as <span className="font-mono text-white/60">NOT_REPORTED</span> rather than assumed healthy.
        </p>
      </GlassCard>
    </div>
  );
}
