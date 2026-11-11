import React, { useEffect, useState } from 'react';
import {
  Server,
  Database,
  Radio,
  Cpu,
  HardDrive,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Terminal
} from 'lucide-react';
import api from '../lib/api.js';
import { describeApiError, normalizeServiceHealth } from '../lib/contracts.js';

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
  }, []);

  const byName = new Map((health?.services || []).map(service => [service.name, service]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight">System Settings & Topology</h2>
          <p className="text-sm text-slate-400 mt-1">
            Service registry, telemetry ports, storage layout, and real native-core build state.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Probing...' : 'Refresh Status'}
        </button>
      </div>

      {healthError && (
        <div className="p-4 bg-rose-950/30 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Health probe unavailable ({healthError.code || 'ERROR'})</div>
            <div className="mt-1">{healthError.detail}</div>
          </div>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Server className="w-4 h-4 text-indigo-400" />
          Service Port Allocation & Database Ownership
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {serviceConfigs.map((service) => {
            const live = byName.get(service.name);
            return (
              <div
                key={service.name}
                className="p-4 bg-slate-950/70 border border-slate-800 rounded-lg space-y-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200 text-sm">{service.name}</span>
                  <span className="font-mono text-indigo-400 font-bold">Port :{service.port}</span>
                </div>
                <div className="text-slate-400">
                  <span className="text-slate-500">Stack:</span> {service.tech}
                </div>
                <div className="text-slate-400 flex items-center gap-1">
                  <Database className="w-3 h-3 text-slate-500" />
                  {service.db}
                </div>
                <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">Live probe:</span>
                  <span className={`font-semibold flex items-center gap-1 ${
                    live?.status === 'UP'
                      ? 'text-emerald-400'
                      : live?.status === 'DOWN'
                        ? 'text-amber-400'
                        : 'text-rose-400'
                  }`}>
                    {live?.status === 'UP'
                      ? <CheckCircle2 className="w-3 h-3" />
                      : <AlertTriangle className="w-3 h-3" />}
                    {live ? `${live.status}${live.latencyMs === null ? '' : ` · ${live.latencyMs}ms`}` : 'NOT REPORTED'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Radio className="w-4 h-4 text-indigo-400" />
          OpenTelemetry Collectors & Telemetry Sinks
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {telemetryConfigs.map((telemetry) => (
            <div
              key={`${telemetry.name}-${telemetry.port}`}
              className="p-4 bg-slate-950/70 border border-slate-800 rounded-lg flex items-center justify-between text-xs"
            >
              <div>
                <div className="font-semibold text-slate-200 text-sm">{telemetry.name}</div>
                <div className="text-slate-400 mt-0.5">{telemetry.protocol}</div>
              </div>
              <span className="font-mono text-indigo-400 font-bold text-sm bg-indigo-950/40 border border-indigo-900/60 px-3 py-1 rounded-md">
                Port :{telemetry.port}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-3">
          <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-2 flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-indigo-400" />
            File Storage & Crash Spool Isolation
          </h3>
          <div className="space-y-2 text-xs font-mono">
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
              <div className="text-slate-400 text-[11px] mb-1">SQLite data directory:</div>
              <div className="text-indigo-300 break-all">%LOCALAPPDATA%\CausalOTel\data\</div>
            </div>
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
              <div className="text-slate-400 text-[11px] mb-1">Incident spool directory:</div>
              <div className="text-indigo-300 break-all">%LOCALAPPDATA%\CausalOTel\spool\incidents\</div>
            </div>
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
              <div className="text-slate-400 text-[11px] mb-1">Tempo data / WAL:</div>
              <div className="text-indigo-300 break-all">%LOCALAPPDATA%\CausalOTel\tempo-data\</div>
            </div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-3">
          <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-2 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-indigo-400" />
            Native Sweep-Line Core
          </h3>

          {nativeError && (
            <div className="p-3 bg-rose-950/30 border border-rose-800 rounded-lg text-xs text-rose-300">
              Native core status unavailable: {nativeError.detail}
            </div>
          )}

          {nativeCore && (
            <div className="space-y-2 text-xs font-mono">
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                <div className="text-slate-400 text-[11px] mb-1">CMake target:</div>
                <div className="text-indigo-300 font-semibold">{nativeCore.target}</div>
              </div>

              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                <div className="text-slate-400 text-[11px] mb-1">Build output:</div>
                {nativeCore.available ? (
                  <div className="text-emerald-400 font-semibold break-all">{nativeCore.binary}</div>
                ) : (
                  <div className="text-amber-400 font-semibold">NOT BUILT</div>
                )}
              </div>

              {!nativeCore.available && (
                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[11px] mb-1 flex items-center gap-1">
                    <Terminal className="w-3 h-3" />
                    Build command:
                  </div>
                  <div className="text-slate-300 break-all">{nativeCore.buildCommand}</div>
                </div>
              )}

              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                <div className="text-slate-400 text-[11px] mb-1">Algorithm:</div>
                <div className="text-indigo-300">O(N log N) interval union; pure-JS fallback when absent</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
