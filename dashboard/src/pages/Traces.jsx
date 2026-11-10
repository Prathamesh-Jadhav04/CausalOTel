import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, Clock, ArrowRight, Search, CheckCircle, AlertTriangle } from 'lucide-react';

const mockTraces = [
  {
    traceId: 'trace-chk-771a4f09',
    rootOperation: 'POST /api/orders/checkout',
    rootService: 'order-service',
    durationMs: 3250,
    spanCount: 4,
    status: 'ERROR',
    timestamp: '1 min ago',
    issue: 'Payment 504 Timeout'
  },
  {
    traceId: 'trace-chk-992b8c12',
    rootOperation: 'POST /api/orders/checkout',
    rootService: 'order-service',
    durationMs: 145,
    spanCount: 4,
    status: 'OK',
    timestamp: '5 mins ago',
    issue: null
  },
  {
    traceId: 'trace-inv-443c1d99',
    rootOperation: 'POST /api/inventory/reserve',
    rootService: 'inventory-service',
    durationMs: 25,
    spanCount: 2,
    status: 'OK',
    timestamp: '12 mins ago',
    issue: null
  },
  {
    traceId: 'trace-chk-112e5f33',
    rootOperation: 'POST /api/orders/checkout',
    rootService: 'order-service',
    durationMs: 410,
    spanCount: 4,
    status: 'ERROR',
    timestamp: '25 mins ago',
    issue: 'Insufficient Stock 409'
  }
];

export default function Traces() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = mockTraces.filter(t => 
    t.traceId.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.rootOperation.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight">Distributed Traces</h2>
          <p className="text-sm text-slate-400 mt-1">Tempo-ingested OpenTelemetry W3C trace streams with span-level self-time breakdown.</p>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search trace ID or endpoint..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 pr-4 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-64"
          />
        </div>
      </div>

      <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900/60 text-slate-400 uppercase text-[11px] font-semibold border-b border-slate-700/60">
            <tr>
              <th className="py-3.5 px-6">Trace ID</th>
              <th className="py-3.5 px-6">Root Endpoint</th>
              <th className="py-3.5 px-6">Service</th>
              <th className="py-3.5 px-6">Duration</th>
              <th className="py-3.5 px-6">Spans</th>
              <th className="py-3.5 px-6">Status</th>
              <th className="py-3.5 px-6 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/40 text-slate-300">
            {filtered.map((t) => (
              <tr key={t.traceId} className="hover:bg-slate-750/30 transition">
                <td className="py-3.5 px-6 font-mono font-medium text-indigo-400">{t.traceId}</td>
                <td className="py-3.5 px-6 font-medium text-slate-200">{t.rootOperation}</td>
                <td className="py-3.5 px-6">
                  <span className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded border border-slate-700">
                    {t.rootService}
                  </span>
                </td>
                <td className="py-3.5 px-6 font-mono">{t.durationMs}ms</td>
                <td className="py-3.5 px-6 font-mono">{t.spanCount}</td>
                <td className="py-3.5 px-6">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                    t.status === 'OK'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                  }`}>
                    {t.status === 'OK' ? <CheckCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                    {t.status}
                  </span>
                </td>
                <td className="py-3.5 px-6 text-right">
                  <button
                    onClick={() => navigate(`/traces/${t.traceId}`)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-400 hover:text-indigo-300"
                  >
                    Inspect Gantt <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
