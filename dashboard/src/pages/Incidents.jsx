import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Search,
  ArrowRight,
  CheckCircle2,
  Clock,
  Server,
  Filter,
  RefreshCw,
  Database
} from 'lucide-react';
import api from '../lib/api.js';
import { describeApiError, normalizeIncidentList } from '../lib/contracts.js';

export default function Incidents() {
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState(null);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/analysis/incidents', { params: { limit: 200 } });
      setIncidents(normalizeIncidentList(response.data));
      setError(null);
    } catch (err) {
      setIncidents(null);
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filteredIncidents = (incidents || []).filter((incident) => {
    const needle = searchTerm.toLowerCase();
    const matchesSearch =
      incident.incidentId.toLowerCase().includes(needle) ||
      incident.culpritService.toLowerCase().includes(needle) ||
      incident.rootCauseType.toLowerCase().includes(needle);
    const matchesStatus = statusFilter === 'ALL' || incident.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight">Causal Incidents</h2>
          <p className="text-sm text-slate-400 mt-1">
            Durable incident records produced by real trace analysis. No seeded or fabricated incidents.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Refreshing...' : 'Refresh Incidents'}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/30 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Incident store unavailable ({error.code || 'ERROR'})</div>
            <div className="mt-1">{error.detail}</div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-slate-900 border border-slate-800 p-4 rounded-xl">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search incident ID, culprit service, or root cause..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-xs text-slate-400 font-medium">Status:</span>
          {['ALL', 'ACTIVE', 'RESOLVED'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                statusFilter === status
                  ? 'bg-indigo-600 text-white shadow'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {loading && incidents === null ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400 animate-pulse">
            Loading incident records...
          </div>
        ) : filteredIncidents.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400">
            <Database className="w-8 h-8 text-slate-500 mx-auto mb-2" />
            <p className="text-base font-medium text-slate-300">
              {incidents?.length ? 'No incidents match the filters' : 'No incidents recorded'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {incidents?.length
                ? 'Adjust the search term or status filter.'
                : 'Incidents appear only after a real Tempo trace is analyzed from the Traces page.'}
            </p>
            {!incidents?.length && (
              <button
                onClick={() => navigate('/traces')}
                className="mt-4 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5"
              >
                Browse Tempo Traces <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ) : (
          filteredIncidents.map((incident) => (
            <div
              key={incident.incidentId}
              className="bg-slate-900 border border-slate-800 hover:border-slate-700 transition rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm"
            >
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-mono text-sm font-semibold text-slate-200">{incident.incidentId}</span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      incident.severity === 'CRITICAL'
                        ? 'bg-red-950/60 border border-red-800 text-red-300'
                        : incident.severity === 'HIGH'
                          ? 'bg-amber-950/60 border border-amber-800 text-amber-300'
                          : 'bg-indigo-950/60 border border-indigo-800 text-indigo-300'
                    }`}
                  >
                    {incident.severity}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      incident.status === 'ACTIVE'
                        ? 'bg-rose-950/80 border border-rose-800 text-rose-300'
                        : 'bg-emerald-950/60 border border-emerald-800 text-emerald-300'
                    }`}
                  >
                    {incident.status}
                  </span>
                  {incident.createdAt && (
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {new Date(incident.createdAt).toLocaleString()}
                    </span>
                  )}
                </div>

                <p className="text-sm text-slate-300 font-medium">{incident.summary}</p>

                <div className="flex items-center gap-4 text-xs text-slate-400 flex-wrap">
                  <span className="flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5 text-indigo-400" />
                    Culprit: <span className="font-mono font-semibold text-rose-400">{incident.culpritService}</span>
                  </span>
                  <span>•</span>
                  <span className="font-mono">{incident.rootCauseType}</span>
                  <span>•</span>
                  <span>
                    Confidence:{' '}
                    <span className="font-semibold text-emerald-400">
                      {incident.confidenceScore === null
                        ? 'not scored'
                        : `${(incident.confidenceScore * 100).toFixed(0)}%`}
                    </span>
                  </span>
                  {incident.traceId && (
                    <>
                      <span>•</span>
                      <span className="font-mono text-slate-400">Trace: {incident.traceId}</span>
                    </>
                  )}
                  {!incident.metricsAvailable && (
                    <>
                      <span>•</span>
                      <span className="text-amber-400">Prometheus correlation unavailable</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate(`/rca/${incident.incidentId}`)}
                  className="px-3.5 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  Inspect RCA
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
