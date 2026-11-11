import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Clock,
  GitCommit,
  Cpu,
  Activity,
  Sparkles,
  ArrowRight,
  Code,
  RefreshCw,
  Layers
} from 'lucide-react';
import api from '../lib/api.js';
import { describeApiError, normalizeIncident, normalizeIncidentList } from '../lib/contracts.js';

export default function RcaDetail() {
  const { incidentId } = useParams();
  const navigate = useNavigate();
  const [incident, setIncident] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showJson, setShowJson] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      if (incidentId) {
        const response = await api.get(`/api/analysis/incidents/${encodeURIComponent(incidentId)}`);
        const normalized = normalizeIncident(response.data);
        if (!normalized) {
          setIncident(null);
          setError({ code: 'INVALID_INCIDENT', detail: 'The server returned an incident without an incidentId.' });
        } else {
          setIncident(normalized);
        }
      } else {
        const response = await api.get('/api/analysis/incidents', { params: { limit: 1 } });
        const latest = normalizeIncidentList(response.data)[0] || null;
        setIncident(latest);
        if (!latest) {
          setError(null);
        }
      }
    } catch (err) {
      setIncident(null);
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [incidentId]);

  const data = incident;
  const evidence = data?.evidence || [];
  const causalPath = data?.causalPath || [];
  const remediations = data?.remediations || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/incidents')}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
              <span>Root Cause Analysis</span>
              {data && <span className="font-mono text-base font-normal text-slate-400">({data.incidentId})</span>}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Recorded incident detail from real Tempo spans and Prometheus correlation.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={load}
            disabled={loading}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition"
            title="Reload incident"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {data && (
            <button
              onClick={() => setShowJson(!showJson)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium border border-slate-700 flex items-center gap-1.5 transition"
            >
              <Code className="w-3.5 h-3.5" />
              {showJson ? 'Hide Raw JSON' : 'View Raw JSON'}
            </button>
          )}
        </div>
      </div>

      {loading && !data && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400 animate-pulse">
          Loading incident record...
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-950/30 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Incident unavailable ({error.code || 'ERROR'})</div>
            <div className="mt-1">{error.detail}</div>
          </div>
        </div>
      )}

      {!loading && !error && !data && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400">
          <Layers className="w-8 h-8 text-slate-500 mx-auto mb-2" />
          <p className="text-base font-medium text-slate-300">No incident records exist</p>
          <p className="text-xs text-slate-500 mt-1">
            Analyze a real Tempo trace to produce the first root cause incident.
          </p>
          <button
            onClick={() => navigate('/traces')}
            className="mt-4 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5"
          >
            Browse Traces <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {data && (
        <>
          <div className="bg-gradient-to-r from-red-950/40 via-slate-900 to-slate-900 border border-red-800/60 rounded-xl p-6 shadow-lg">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-900/60 border border-red-700 text-red-200">
                    {data.severity} ROOT CAUSE
                  </span>
                  {data.analyzedAt && (
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(data.analyzedAt).toLocaleString()}
                    </span>
                  )}
                  {data.traceId && (
                    <button
                      onClick={() => navigate(`/traces/${encodeURIComponent(data.traceId)}`)}
                      className="text-xs font-mono text-indigo-400 hover:text-indigo-300 underline"
                    >
                      trace {data.traceId}
                    </button>
                  )}
                </div>
                <h3 className="text-xl font-bold text-slate-100 flex items-center gap-2 flex-wrap">
                  Culprit Service: <span className="font-mono text-rose-400">{data.culpritService}</span>
                </h3>
                <p className="text-sm text-slate-300 max-w-2xl">{data.summary}</p>
                <p className="text-xs text-slate-400 font-mono">Root cause type: {data.rootCauseType}</p>
              </div>

              <div className="flex items-center gap-6 bg-slate-950/60 border border-slate-800 p-4 rounded-xl">
                <div className="text-center">
                  <div className="text-2xl font-bold text-emerald-400">
                    {data.confidenceScore === null ? '—' : `${(data.confidenceScore * 100).toFixed(0)}%`}
                  </div>
                  <div className="text-xs text-slate-400 font-medium mt-0.5">Confidence</div>
                </div>
                <div className="w-px h-10 bg-slate-800"></div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-indigo-400">{evidence.length}</div>
                  <div className="text-xs text-slate-400 font-medium mt-0.5">Evidence Signals</div>
                </div>
              </div>
            </div>
          </div>

          {!data.metricsAvailable && (
            <div className="p-4 bg-amber-950/30 border border-amber-800 rounded-xl text-xs text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Prometheus correlation unavailable</div>
                <div className="mt-1">
                  {data.metricsError?.message || data.metricsError?.code || 'Metrics were not available during analysis.'}{' '}
                  Confidence is based on trace evidence only.
                </div>
              </div>
            </div>
          )}

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-2">
              <GitCommit className="w-4 h-4 text-indigo-400" />
              Causal Propagation Path
            </h3>
            {causalPath.length === 0 ? (
              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800/80 text-xs text-slate-400">
                The analysis engine recorded no causal path for this incident.
              </div>
            ) : (
              <div className="flex flex-col md:flex-row items-center justify-between gap-3 p-4 bg-slate-950 rounded-xl border border-slate-800/80">
                {causalPath.map((step, index) => {
                  const isCulprit = step.service === data.culpritService;
                  return (
                    <React.Fragment key={`${step.service}-${index}`}>
                      <div
                        className={`flex-1 w-full p-4 rounded-lg border text-center transition ${
                          isCulprit
                            ? 'bg-red-950/30 border-red-700/80 text-rose-200 shadow-md'
                            : 'bg-slate-900/60 border-slate-800 text-slate-300'
                        }`}
                      >
                        <div className="text-xs text-slate-400 mb-1 font-mono">Hop {index + 1}</div>
                        <div className="font-mono font-semibold text-sm">{step.service}</div>
                        <div className="flex items-center justify-center gap-2 mt-2 text-xs">
                          <span className="font-mono text-slate-400">{step.latency}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              isCulprit
                                ? 'bg-rose-900/80 text-rose-200'
                                : 'bg-amber-900/60 text-amber-200'
                            }`}
                          >
                            {step.status}
                          </span>
                        </div>
                      </div>
                      {index < causalPath.length - 1 && (
                        <ArrowRight className="w-5 h-5 text-slate-600 hidden md:block shrink-0" />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-400" />
                Causal Evidence Chain
              </h3>
              {evidence.length === 0 ? (
                <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-lg text-xs text-slate-400">
                  No evidence signals were recorded.
                </div>
              ) : (
                <div className="space-y-3">
                  {evidence.map((item, index) => (
                    <div
                      key={`${item.type}-${index}`}
                      className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-lg flex items-start gap-3"
                    >
                      <div className="mt-0.5">
                        {item.severity === 'CRITICAL' ? (
                          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                        ) : item.severity === 'HIGH' ? (
                          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        )}
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono text-xs font-semibold text-slate-300">{item.type}</span>
                          {item.value !== undefined && item.value !== null && (
                            <span className="font-mono text-xs text-indigo-400 font-medium">{String(item.value)}</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">{item.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-6">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-indigo-400" />
                  Sweep-Line Interval Union
                </h3>
                {data.sweepLineMetrics ? (
                  <div className="space-y-3 bg-slate-950 p-4 rounded-lg border border-slate-800 text-xs font-mono">
                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400">Total Span Duration:</span>
                      <span className="text-slate-200 font-semibold">
                        {data.sweepLineMetrics.totalSpanDurationMs} ms
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400">Child Spans Overlap:</span>
                      <span className="text-slate-200 font-semibold">
                        {data.sweepLineMetrics.childSpansOverlapMs} ms
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400">Net Exclusive Self-Time:</span>
                      <span className="text-rose-400 font-bold">{data.sweepLineMetrics.netSelfTimeMs} ms</span>
                    </div>
                    <div className="flex justify-between py-1 text-slate-500 text-[11px]">
                      <span>Engine Implementation:</span>
                      <span className="text-indigo-400">{data.sweepLineMetrics.engineUsed}</span>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-lg text-xs text-slate-400">
                    No sweep-line metrics were recorded for this incident.
                  </div>
                )}
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  Automated Remediation Actions
                </h3>
                {remediations.length === 0 ? (
                  <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-lg text-xs text-slate-400">
                    No remediation recommendation was recorded.
                  </div>
                ) : (
                  <ul className="space-y-2 text-xs text-slate-300">
                    {remediations.map((action, index) => (
                      <li
                        key={`${action}-${index}`}
                        className="flex items-start gap-2.5 p-2 bg-slate-950/60 rounded-lg border border-slate-800"
                      >
                        <span className="w-5 h-5 rounded-full bg-indigo-950 border border-indigo-700 text-indigo-300 flex items-center justify-center shrink-0 font-bold text-[10px]">
                          {index + 1}
                        </span>
                        <span className="mt-0.5 leading-relaxed">{action}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {showJson && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 overflow-x-auto">
              <div className="text-xs font-semibold text-slate-400 mb-2">Recorded Incident JSON:</div>
              <pre className="text-xs font-mono text-emerald-400 leading-relaxed">
                {JSON.stringify(data, null, 2)}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
