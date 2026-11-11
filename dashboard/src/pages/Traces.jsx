import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, ArrowRight, Search, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import api from '../lib/api.js';
import { describeApiError, normalizeTracesResponse } from '../lib/contracts.js';

export default function Traces() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [traces, setTraces] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/analysis/traces', { params: { limit: 50 } });
      setTraces(normalizeTracesResponse(response.data));
      setError(null);
    } catch (err) {
      setTraces(null);
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = (traces || []).filter(trace =>
    trace.traceId.toLowerCase().includes(searchTerm.toLowerCase()) ||
    trace.rootOperation.toLowerCase().includes(searchTerm.toLowerCase()) ||
    trace.rootService.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const timestampLabel = (trace) => {
    if (!trace.startTimeUnixNano) {
      return '—';
    }
    const millis = Number(BigInt(trace.startTimeUnixNano) / 1_000_000n);
    return Number.isFinite(millis) ? new Date(millis).toLocaleString() : '—';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight">Distributed Traces</h2>
          <p className="text-sm text-slate-400 mt-1">
            Tempo search results only. When Tempo is unavailable the page says so instead of showing fixtures.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search trace ID, endpoint, service..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="pl-9 pr-4 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-72"
            />
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/30 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Tempo unavailable ({error.code || 'TEMPO_ERROR'})</div>
            <div className="mt-1">{error.detail}</div>
          </div>
        </div>
      )}

      <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900/60 text-slate-400 uppercase text-[11px] font-semibold border-b border-slate-700/60">
            <tr>
              <th className="py-3.5 px-6">Trace ID</th>
              <th className="py-3.5 px-6">Root Endpoint</th>
              <th className="py-3.5 px-6">Service</th>
              <th className="py-3.5 px-6">Duration</th>
              <th className="py-3.5 px-6">Started</th>
              <th className="py-3.5 px-6">Status</th>
              <th className="py-3.5 px-6 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/40 text-slate-300">
            {filtered.map((trace) => (
              <tr key={trace.traceId} className="hover:bg-slate-750/30 transition">
                <td className="py-3.5 px-6 font-mono font-medium text-indigo-400">{trace.traceId}</td>
                <td className="py-3.5 px-6 font-medium text-slate-200">{trace.rootOperation}</td>
                <td className="py-3.5 px-6">
                  <span className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded border border-slate-700">
                    {trace.rootService}
                  </span>
                </td>
                <td className="py-3.5 px-6 font-mono">
                  {trace.durationMs === null ? '—' : `${trace.durationMs}ms`}
                </td>
                <td className="py-3.5 px-6 text-slate-400">{timestampLabel(trace)}</td>
                <td className="py-3.5 px-6">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                    trace.status === 'OK' || trace.status === 'STATUS_CODE_OK'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : trace.status === 'UNKNOWN'
                        ? 'bg-slate-500/10 text-slate-300 border-slate-500/20'
                        : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                  }`}>
                    {trace.status === 'OK' || trace.status === 'STATUS_CODE_OK'
                      ? <CheckCircle className="w-3 h-3" />
                      : <AlertTriangle className="w-3 h-3" />}
                    {trace.status}
                  </span>
                </td>
                <td className="py-3.5 px-6 text-right">
                  <button
                    onClick={() => navigate(`/traces/${trace.traceId}`)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-400 hover:text-indigo-300"
                  >
                    Inspect Gantt <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!loading && !error && filtered.length === 0 && (
          <div className="p-12 text-center text-slate-400">
            <Layers className="w-8 h-8 mx-auto mb-2 text-slate-500" />
            <p className="text-base font-medium text-slate-300">
              {traces?.length ? 'No traces match the search' : 'No traces found in Tempo'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {traces?.length
                ? 'Adjust the search term.'
                : 'Generate checkout traffic or verify the OTel Collector → Tempo pipeline.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
