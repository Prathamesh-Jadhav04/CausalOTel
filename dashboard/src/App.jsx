import React, { useState, useEffect } from 'react';
import { Activity, Server, Database, ShieldCheck, CheckCircle2, AlertTriangle } from 'lucide-react';

const SERVICES = [
  { name: 'User Service', port: 8081, path: '/health/live', tech: 'Java 25 / Spring Boot 4' },
  { name: 'Product Service', port: 8082, path: '/health/live', tech: 'Java 25 / Spring Boot 4' },
  { name: 'Order Service', port: 8083, path: '/health/live', tech: 'Java 25 / Spring Boot 4' },
  { name: 'Payment Service', port: 8084, path: '/health/live', tech: 'Java 25 / Spring Boot 4' },
  { name: 'Inventory Service', port: 5050, path: '/health/live', tech: 'C# / .NET 10 LTS' },
  { name: 'Analysis Engine', port: 5000, path: '/health/live', tech: 'Node.js 26 / Express 5' }
];

export default function App() {
  const [statuses, setStatuses] = useState({});

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8 font-sans">
      <header className="max-w-6xl mx-auto mb-10 pb-6 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
            CausalOTel
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Distributed Microservices Root Cause Analysis Platform — Phase 2 Foundation
          </p>
        </div>
        <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-4 py-2 rounded-lg text-sm text-slate-300">
          <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
          <span>System Foundation: Active</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto">
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4 text-slate-200 flex items-center gap-2">
            <Server className="w-5 h-5 text-indigo-400" />
            Service Mesh Topology
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {SERVICES.map((svc) => (
              <div 
                key={svc.name}
                className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-5 hover:border-slate-700 transition shadow-lg"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-slate-100 text-lg">{svc.name}</h3>
                    <span className="text-xs text-indigo-400 font-mono">Port :{svc.port}</span>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-800/60 text-emerald-300">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    Scaffolded
                  </span>
                </div>
                <div className="text-xs text-slate-400 space-y-1 mt-4 pt-3 border-t border-slate-800">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Runtime:</span>
                    <span className="text-slate-300">{svc.tech}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Live Probe:</span>
                    <span className="font-mono text-slate-300">{svc.path}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            Phase 2 Gate 2 Architectural Guarantees
          </h2>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-slate-300">
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400"></span>
              Isolated SQLite per service with WAL mode & busy timeout
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400"></span>
              Single-use hashed bootstrap token admin registration
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400"></span>
              Fail-closed payment simulation safety checks
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400"></span>
              Crash-resilient atomic incident spool with 500MB cap
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400"></span>
              Immediate SQLite write locks & reservation timeout
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400"></span>
              Strict RFC 9457 Problem Details error responses
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
