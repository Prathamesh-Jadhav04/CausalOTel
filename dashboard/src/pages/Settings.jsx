import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  HardDrive,
  Radio,
  RefreshCw,
  Server,
  Terminal
} from 'lucide-react';
import api from '../lib/api.js';
import { describeApiError, normalizeServiceHealth } from '../lib/contracts.js';
import {
  Badge,
  Button,
  CardHeader,
  CopyButton,
  ErrorBanner,
  GlassCard,
  MetaChip,
  PageHeader,
  StatusBadge,
  cn
} from '../components/ui.jsx';

const serviceConfigs = [
  { name: 'user-service', port: 8081, tech: 'Java 25 / Spring Boot 4.0', db: 'user.db (WAL)' },
  { name: 'product-service', port: 8082, tech: 'Java 25 / Spring Boot 4.0', db: 'product.db (WAL)' },
  { name: 'order-service', port: 8083, tech: 'Java 25 / Spring Boot 4.0', db: 'order.db (WAL)' },
  { name: 'payment-service', port: 8084, tech: 'Java 25 / Spring Boot 4.0', db: 'payment.db (WAL)' },
  { name: 'inventory-service', port: 5050, tech: '.NET 10 / ASP.NET Core', db: 'inventory.db (WAL)' },
  { name: 'analysis-engine', port: 5000, tech: 'Node.js 26 / Express 5', db: 'Durable disk spool' }
];

const telemetryConfigs = [
  { name: 'OTLP gRPC receiver', port: 4317, protocol: 'Collector · gRPC protobuf' },
  { name: 'OTLP HTTP receiver', port: 4318, protocol: 'Collector · HTTP protobuf/JSON' },
  { name: 'Collector Prometheus exporter', port: 8889, protocol: 'Collector · HTTP /metrics' },
  { name: 'Tempo OTLP gRPC receiver', port: 4320, protocol: 'Tempo · gRPC protobuf' },
  { name: 'Tempo HTTP API', port: 3200, protocol: 'Tempo · HTTP query API' },
  { name: 'Prometheus HTTP API', port: 9090, protocol: 'Prometheus · PromQL API' }
];

export default function Settings() {
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(null);
  const [nativeCore, setNativeCore] = useState(null);
  const [nativeError, setNativeError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);

    const [healthResult, nativeResult] = await Promise.allSettled([
      api.get('/api/analysis/services'),
      api.get('/api/analysis/native-core')
    ]);

    if (healthResult.status === 'fulfilled') {
      setHealth(normalizeServiceHealth(healthResult.value.data));
      setHealthError(null);
    } else {
      setHealth(null);
      setHealthError(describeApiError(healthResult.reason));
    }

    if (nativeResult.status === 'fulfilled') {
      setNativeCore(nativeResult.value.data);
      setNativeError(null);
    } else {
      setNativeCore(null);
      setNativeError(describeApiError(nativeResult.reason));
    }

    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byName = new Map((health?.services || []).map(service => [service.name, service]));

  return (
    <div className="space-y-5 lg:space-y-6">
      <PageHeader
        eyebrow="System registry"
        title="Settings & topology"
        description="Service registry, telemetry ports, storage layout, and real native-core build state."
        actions={
          <Button onClick={load} loading={loading} variant="secondary">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            {loading ? 'Probing' : 'Refresh status'}
          </Button>
        }
        meta={
          <>
            <MetaChip icon={Server}>{serviceConfigs.length} services</MetaChip>
            <MetaChip icon={Radio}>{telemetryConfigs.length} telemetry endpoints</MetaChip>
          </>
        }
      />

      {healthError && (
        <ErrorBanner
          title="Health probe unavailable"
          detail={healthError.detail}
          code={healthError.code || 'ERROR'}
        />
      )}

      <GlassCard className="p-4 sm:p-6">
        <CardHeader
          icon={Server}
          eyebrow="Registry"
          title="Service port allocation & database ownership"
          description="Static topology metadata paired with the latest live probe result."
        />
        <div className="mt-4 grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {serviceConfigs.map((service) => {
            const live = byName.get(service.name);
            return (
              <div
                key={service.name}
                className="rounded-lg border border-white/[0.065] bg-white/[0.025] p-3.5 transition hover:border-white/12 hover:bg-white/[0.04]"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="break-all font-mono text-[12px] font-semibold text-white/84">{service.name}</span>
                  <Badge tone="signal">:{service.port}</Badge>
                </div>
                <div className="mt-2 space-y-1.5 text-[10px] text-white/48">
                  <p className="break-words"><span className="text-white/32">Stack:</span> {service.tech}</p>
                  <p className="flex items-center gap-1.5">
                    <Database className="h-3 w-3 shrink-0 text-white/32" />
                    <span className="truncate">{service.db}</span>
                  </p>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-2.5">
                  <span className="text-[9px] uppercase tracking-[0.12em] text-white/32">Live probe</span>
                  <span className="inline-flex items-center gap-1.5">
                    {live?.status === 'UP'
                      ? <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                      : <AlertTriangle className="h-3 w-3 text-amber-400" />}
                    <span className={cn(
                      'text-[10px] font-semibold',
                      live?.status === 'UP' ? 'text-emerald-300' : live?.status === 'DOWN' ? 'text-amber-300' : 'text-rose-300'
                    )}>
                      {live ? `${live.status}${live.latencyMs === null ? '' : ` · ${live.latencyMs}ms`}` : 'NOT REPORTED'}
                    </span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>

      <GlassCard className="p-4 sm:p-6">
        <CardHeader
          icon={Radio}
          eyebrow="Telemetry"
          title="OpenTelemetry collectors & sinks"
          description="Local receiver and query ports used by the dashboard's live data paths."
        />
        <div className="mt-4 grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {telemetryConfigs.map((telemetry) => (
            <div
              key={`${telemetry.name}-${telemetry.port}`}
              className="flex flex-col gap-2 rounded-lg border border-white/[0.065] bg-white/[0.025] p-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-white/78">{telemetry.name}</p>
                <p className="mt-0.5 text-[10px] text-white/44">{telemetry.protocol}</p>
              </div>
              <Badge tone="signal" className="shrink-0 self-start sm:self-auto">Port :{telemetry.port}</Badge>
            </div>
          ))}
        </div>
      </GlassCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
        <GlassCard className="p-4 sm:p-6">
          <CardHeader
            icon={HardDrive}
            eyebrow="Storage"
            title="File storage & crash spool isolation"
          />
          <div className="mt-4 space-y-2 font-mono">
            <div className="rounded-lg border border-white/[0.06] bg-inset p-3.5">
              <p className="font-medium uppercase text-[10px] tracking-[0.045em] text-ink-subtle">SQLite data directory</p>
              <div className="mt-1 flex items-center gap-2">
                <p className="min-w-0 break-all text-[11px] text-signal-300/80">%LOCALAPPDATA%\CausalOTel\data\</p>
                <CopyButton compact value="%LOCALAPPDATA%\\CausalOTel\\data\\" label="Copy SQLite data path" />
              </div>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-inset p-3.5">
              <p className="font-medium uppercase text-[10px] tracking-[0.045em] text-ink-subtle">Incident spool directory</p>
              <div className="mt-1 flex items-center gap-2">
                <p className="min-w-0 break-all text-[11px] text-signal-300/80">%LOCALAPPDATA%\CausalOTel\spool\incidents\</p>
                <CopyButton compact value="%LOCALAPPDATA%\\CausalOTel\\spool\\incidents\\" label="Copy incident spool path" />
              </div>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-inset p-3.5">
              <p className="font-medium uppercase text-[10px] tracking-[0.045em] text-ink-subtle">Tempo data / WAL</p>
              <div className="mt-1 flex items-center gap-2">
                <p className="min-w-0 break-all text-[11px] text-signal-300/80">%LOCALAPPDATA%\CausalOTel\tempo-data\</p>
                <CopyButton compact value="%LOCALAPPDATA%\\CausalOTel\\tempo-data\\" label="Copy Tempo data path" />
              </div>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-4 sm:p-6">
          <CardHeader
            icon={Cpu}
            eyebrow="Native core"
            title="Sweep-line interval union"
            action={nativeCore && (
              <StatusBadge status={nativeCore.available ? 'AVAILABLE' : 'NOT BUILT'} />
            )}
          />

          {nativeError && (
            <ErrorBanner
              title="Native core status unavailable"
              detail={nativeError.detail}
              className="mt-4"
            />
          )}

          {nativeCore && (
            <div className="mt-4 space-y-2 font-mono">
              <div className="rounded-lg border border-white/[0.06] bg-inset p-3.5">
                <p className="text-[9px] uppercase tracking-[0.12em] text-white/36">CMake target</p>
                <p className="mt-1 break-all text-[11px] font-semibold text-signal-300/80">{nativeCore.target}</p>
              </div>

              <div className="rounded-lg border border-white/[0.06] bg-inset p-3.5">
                <p className="text-[9px] uppercase tracking-[0.12em] text-white/36">Build output</p>
                {nativeCore.available ? (
                  <p className="mt-1 break-all text-[11px] font-semibold text-emerald-300">{nativeCore.binary}</p>
                ) : (
                  <p className="mt-1 text-[11px] font-semibold text-amber-300">NOT BUILT</p>
                )}
              </div>

              {!nativeCore.available && (
                <div className="rounded-lg border border-white/[0.06] bg-inset p-3.5">
                  <p className="flex items-center gap-1 font-medium uppercase text-[10px] tracking-[0.045em] text-ink-subtle">
                    <Terminal className="h-3 w-3" />
                    Build command
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <p className="min-w-0 break-all text-[11px] text-white/62">{nativeCore.buildCommand}</p>
                    <CopyButton compact value={nativeCore.buildCommand} label="Copy build command" />
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-white/[0.06] bg-inset p-3.5">
                <p className="text-[9px] uppercase tracking-[0.12em] text-white/36">Algorithm</p>
                <p className="mt-1 text-[11px] leading-relaxed text-signal-300/80">
                  O(N log N) interval union; pure-JS fallback when absent
                </p>
              </div>
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
