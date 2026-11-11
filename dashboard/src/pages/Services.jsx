import React, { useEffect, useState } from 'react';
import { Server, Database, RefreshCw, AlertTriangle } from 'lucide-react';
import api from '../lib/api.js';
import { describeApiError, normalizeServiceHealth } from '../lib/contracts.js';

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
  }, []);

  const byName = new Map((health?.services || []).map(service => [service.name, service]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight">Microservices Topology</h2>
          <p className="text-sm text-slate-400 mt-1">
            Live `/health/live` probes from the analysis engine; statuses are never hardcoded.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Probing...' : 'Probe Services'}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/30 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Health probe failed: {error.detail}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {serviceMetadata.map((svc) => {
          const live = byName.get(svc.name);
          const status = live?.status || (error ? 'UNKNOWN' : loading ? 'CHECKING' : 'NOT_REPORTED');
          return (
            <div key={svc.name} className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <Server className="w-4 h-4 text-indigo-400" />
                    {svc.name}
                  </span>
                  <span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full border ${
                    status === 'UP'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : status === 'DOWN'
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        : status === 'CHECKING'
                          ? 'bg-slate-500/10 text-slate-300 border-slate-500/20'
                          : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                  }`}>
                    {status}
                  </span>
                </div>

                <p className="text-xs text-slate-400 mt-2.5 leading-relaxed">
                  {svc.description}
                </p>

                <div className="mt-4 space-y-2 text-xs border-t border-slate-700/50 pt-3">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Runtime</span>
                    <span className="text-slate-300 font-mono">{svc.runtime}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Host Port</span>
                    <span className="text-indigo-400 font-mono font-semibold">:{svc.port}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Storage</span>
                    <span className="text-slate-300 flex items-center gap-1">
                      <Database className="w-3 h-3 text-slate-400" />
                      {svc.db}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Probe latency</span>
                    <span className="text-slate-300 font-mono">
                      {live?.latencyMs === null || live?.latencyMs === undefined ? '—' : `${live.latencyMs}ms`}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-3 border-t border-slate-700/50 flex justify-between text-xs">
                <span className="text-slate-400 font-mono">{svc.health}</span>
                <span className="text-slate-400 font-mono">{svc.metrics}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
