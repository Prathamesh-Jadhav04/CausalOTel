import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Zap, AlertTriangle, RefreshCw, Layers } from 'lucide-react';
import api from '../lib/api.js';
import { describeApiError, normalizeTraceDetail } from '../lib/contracts.js';

export default function TraceDetail() {
  const { traceId } = useParams();
  const navigate = useNavigate();
  const [trace, setTrace] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedSpan, setSelectedSpan] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get(`/api/analysis/traces/${encodeURIComponent(traceId)}`);
      setTrace(normalizeTraceDetail(response.data));
      setError(null);
    } catch (err) {
      setTrace(null);
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedSpan(null);
    setAnalysisError(null);
    load();
  }, [traceId]);

  const analyze = async () => {
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const response = await api.post('/api/analysis/analyze-trace', { traceId });
      if (response.data?.incidentId) {
        navigate(`/rca/${response.data.incidentId}`);
      } else {
        setAnalysisError({ detail: 'The analysis engine returned no incidentId.' });
      }
    } catch (err) {
      setAnalysisError(describeApiError(err));
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/traces')}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              Trace: <span className="font-mono text-indigo-400">{traceId}</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Real Tempo spans with sweep-line interval-union self-time.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition"
            title="Reload trace"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={analyze}
            disabled={analyzing || !trace}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm"
          >
            <Zap className="w-3.5 h-3.5" />
            {analyzing ? 'Analyzing...' : 'Analyze Root Cause'}
          </button>
        </div>
      </div>

      {analysisError && (
        <div className="p-4 bg-rose-950/30 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">RCA failed ({analysisError.code || 'ERROR'})</div>
            <div className="mt-1">{analysisError.detail}</div>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-950/30 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Trace unavailable ({error.code || 'TEMPO_ERROR'})</div>
            <div className="mt-1">{error.detail}</div>
          </div>
        </div>
      )}

      {loading && !trace && (
        <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-12 text-center text-sm text-slate-400 animate-pulse">
          Loading trace from Tempo...
        </div>
      )}

      {trace && trace.spans.length === 0 && (
        <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-12 text-center text-slate-400">
          <Layers className="w-8 h-8 mx-auto mb-2 text-slate-500" />
          <p className="text-base font-medium text-slate-300">Trace contains no spans</p>
          <p className="text-xs text-slate-500 mt-1">The analysis engine refused to fabricate a waterfall.</p>
        </div>
      )}

      {trace && trace.spans.length > 0 && (
        <>
          <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-700/60 pb-3">
              <span className="font-semibold uppercase tracking-wider">Span & Operation</span>
              <span className="font-mono">
                {trace.totalSpans} spans · Total duration: {trace.totalDurationMs.toFixed(1)}ms
              </span>
            </div>

            <div className="space-y-3">
              {trace.spans.map((span) => {
                const leftPercent = trace.totalDurationMs > 0
                  ? (span.startOffsetMs / trace.totalDurationMs) * 100
                  : 0;
                const widthPercent = trace.totalDurationMs > 0
                  ? Math.max(1, (span.durationMs / trace.totalDurationMs) * 100)
                  : 100;
                const isError = span.statusCode === 'ERROR';

                return (
                  <div
                    key={span.spanId}
                    onClick={() => setSelectedSpan(span)}
                    className={`p-3 rounded-lg border cursor-pointer transition ${
                      selectedSpan?.spanId === span.spanId
                        ? 'bg-slate-750 border-indigo-500'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${isError ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                        <span className="font-semibold text-slate-200">{span.name}</span>
                        <span className="px-1.5 py-0.5 bg-slate-800 text-[10px] text-slate-400 rounded font-mono">
                          {span.service}
                        </span>
                      </div>
                      <div className="text-right text-xs font-mono text-slate-400 flex items-center gap-3">
                        <span>Duration: <strong className="text-slate-200">{span.durationMs}ms</strong></span>
                        <span>Self-Time: <strong className="text-indigo-400">{span.selfTimeMs}ms</strong></span>
                      </div>
                    </div>

                    <div className="w-full bg-slate-950 h-3 rounded-full relative overflow-hidden">
                      <div
                        style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
                        className={`absolute top-0 bottom-0 rounded-full ${isError ? 'bg-rose-500' : 'bg-indigo-500'}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {selectedSpan && (
            <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-200">Span Inspector</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                <div>
                  <span className="text-slate-500 block">Span ID</span>
                  <span className="font-mono text-slate-300">{selectedSpan.spanId}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Service</span>
                  <span className="font-mono text-slate-300">{selectedSpan.service}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Computed Self-Time</span>
                  <span className="font-mono text-indigo-400 font-bold">{selectedSpan.selfTimeMs}ms</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Status Message</span>
                  <span className="font-mono text-slate-300">{selectedSpan.statusMessage || selectedSpan.statusCode}</span>
                </div>
              </div>
              <div className="text-[11px] text-slate-500 font-mono">
                Timing engine: {selectedSpan.timingEngine || 'not reported'}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
