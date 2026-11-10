import React from 'react';
import { Server, Database, Activity, ExternalLink, ShieldCheck } from 'lucide-react';

const services = [
  {
    name: 'user-service',
    runtime: 'Java 25 (Spring Boot 4.0)',
    port: 8081,
    db: 'SQLite (user.db)',
    health: '/health/live',
    metrics: '/actuator/prometheus',
    description: 'Manages user identities, cryptographic admin bootstrap tokens, and role-based permissions.'
  },
  {
    name: 'product-service',
    runtime: 'Java 25 (Spring Boot 4.0)',
    port: 8082,
    db: 'SQLite (product.db)',
    health: '/health/live',
    metrics: '/actuator/prometheus',
    description: 'Product catalog microservice with SKU lookup, pricing in integer cents, and stock synchronization.'
  },
  {
    name: 'order-service',
    runtime: 'Java 25 (Spring Boot 4.0)',
    port: 8083,
    db: 'SQLite (order.db)',
    health: '/health/live',
    metrics: '/actuator/prometheus',
    description: 'Saga orchestrator for distributed checkouts with transactional outbox, lease renewals, and compensations.'
  },
  {
    name: 'payment-service',
    runtime: 'Java 25 (Spring Boot 4.0)',
    port: 8084,
    db: 'SQLite (payment.db)',
    health: '/health/live',
    metrics: '/actuator/prometheus',
    description: 'Simulated payment gateway with idempotency hash checks, refund invariants, and fail-closed safety.'
  },
  {
    name: 'inventory-service',
    runtime: '.NET 10 (ASP.NET Core Web API)',
    port: 5050,
    db: 'SQLite (inventory.db)',
    health: '/health/live',
    metrics: '/metrics',
    description: 'High-concurrency stock reservation engine with atomic PRAGMA execution and background TTL expiration.'
  },
  {
    name: 'analysis-engine',
    runtime: 'Node.js 26 (Express 5)',
    port: 5000,
    db: 'MongoDB & Disk Spool',
    health: '/health/live',
    metrics: '/metrics',
    description: 'Heuristic root cause analysis engine, Tempo trace consumer, Tarjan SCC graph solver, and sweep-line bridge.'
  }
];

export default function Services() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-100 tracking-tight">Microservices Topology</h2>
        <p className="text-sm text-slate-400 mt-1">Inspection of the 6 polyglot backend microservices powering CausalOTel.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {services.map((svc) => (
          <div key={svc.name} className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <Server className="w-4 h-4 text-indigo-400" />
                  {svc.name}
                </span>
                <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  ONLINE
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
              </div>
            </div>

            <div className="mt-5 pt-3 border-t border-slate-700/50 flex justify-between text-xs">
              <span className="text-slate-400 font-mono">{svc.health}</span>
              <span className="text-slate-400 font-mono">{svc.metrics}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
