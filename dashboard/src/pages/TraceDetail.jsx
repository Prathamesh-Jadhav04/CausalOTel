import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Layers,
  RefreshCw,
  Zap
} from 'lucide-react';
import api from '../lib/api.js';
import { describeApiError, normalizeTraceDetail } from '../lib/contracts.js';
import { rcaDetailPath } from '../lib/routes.js';
import {
  Badge,
  BottomSheet,
  Button,
  CardHeader,
  CopyButton,
  EmptyState,
  ErrorBanner,
  GlassCard,
  IconButton,
  MetaChip,
  PageHeader,
  StatusBadge,
  cn,
  useMediaQuery
} from '../components/ui.jsx';

export default function TraceDetail() {
  const { traceId } = useParams();
  const navigate = useNavigate();
  const [trace, setTrace] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedSpan, setSelectedSpan] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const compact = useMediaQuery('(max-width: 767px)');

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traceId]);

  const analyze = async () => {
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const response = await api.post('/api/analysis/analyze-trace', { traceId });
      if (response.data?.incidentId) {
        navigate(rcaDetailPath(response.data.incidentId));
      } else {
        setAnalysisError({ detail: 'The analysis engine returned no incidentId.' });
      }
    } catch (err) {
      setAnalysisError(describeApiError(err));
    } finally {
      setAnalyzing(false);
    }
  };

  const errorSpans = trace?.spans?.filter(span => span.statusCode === 'ERROR').length || 0;
  const services = trace?.spans ? new Set(trace.spans.map(span => span.service)).size : 0;

  const spanInspector = selectedSpan && (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={selectedSpan.statusCode === 'ERROR' ? 'rose' : 'emerald'} dot>
          {selectedSpan.statusCode}
        </Badge>
        <Badge>{selectedSpan.service}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="glass-inset rounded-lg p-3.5">
          <p className="font-mono text-[8px] font-medium uppercase tracking-[0.08em] text-white/40">Span ID</p>
          <div className="mt-1 flex items-center gap-2">
            <p className="min-w-0 break-all font-mono text-[11px] text-white/78">{selectedSpan.spanId}</p>
            <CopyButton compact value={selectedSpan.spanId} label="Copy span ID" />
          </div>
        </div>
        <div className="glass-inset rounded-lg p-3.5">
          <p className="text-[8px] font-semibold uppercase tracking-[0.16em] text-white/40">Service</p>
          <p className="mt-1 break-all font-mono text-[11px] text-white/78">{selectedSpan.service}</p>
        </div>
        <div className="glass-inset rounded-lg p-3.5">
          <p className="text-[8px] font-semibold uppercase tracking-[0.16em] text-white/40">Computed self-time</p>
          <p className="mt-1 font-mono text-sm font-semibold text-signal-300">{selectedSpan.selfTimeMs}ms</p>
        </div>
        <div className="glass-inset rounded-lg p-3.5">
          <p className="text-[8px] font-semibold uppercase tracking-[0.16em] text-white/40">Duration</p>
          <p className="mt-1 font-mono text-sm font-semibold text-white/78">{selectedSpan.durationMs}ms</p>
        </div>
        <div className="glass-inset col-span-2 rounded-lg p-3.5">
          <p className="text-[8px] font-semibold uppercase tracking-[0.16em] text-white/40">Status message</p>
          <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-white/70">
            {selectedSpan.statusMessage || selectedSpan.statusCode}
          </p>
        </div>
      </div>
      <p className="break-all font-mono text-[10px] text-white/34">
        Timing engine: {selectedSpan.timingEngine || 'not reported'}
      </p>
    </div>
  );

  return (
    <div className="space-y-5 lg:space-y-6">
      <button
        type="button"
        onClick={() => navigate('/traces')}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/50 transition hover:text-white/78"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to traces
      </button>

      <PageHeader
        eyebrow="Trace detail"
        title={
          <span className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
            <span>Waterfall</span>
            <span className="break-all font-mono text-[11px] font-normal tracking-normal text-white/44 sm:text-sm">
              {traceId}
            </span>
          </span>
        }
        description="Real Tempo spans with sweep-line interval-union self-time."
        actions={
          <>
            <CopyButton compact value={traceId} label="Copy trace ID" />
            <IconButton label="Reload trace" onClick={load} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </IconButton>
            <Button onClick={analyze} disabled={analyzing || !trace} loading={analyzing} variant="primary">
              <Zap className="h-4 w-4" />
              {analyzing ? 'Analyzing' : 'Analyze root cause'}
            </Button>
          </>
        }
        meta={trace ? (
          <>
            <MetaChip icon={Layers}>{trace.totalSpans} spans</MetaChip>
            <MetaChip>{trace.totalDurationMs.toFixed(1)}ms total</MetaChip>
            <MetaChip>{services} services</MetaChip>
            <MetaChip>{errorSpans} errors</MetaChip>
          </>
        ) : null}
      />

      {analysisError && (
        <ErrorBanner
          title="RCA failed"
          detail={analysisError.detail}
          code={analysisError.code || 'ERROR'}
        />
      )}

      {error && (
        <ErrorBanner
          title="Trace unavailable"
          detail={error.detail}
          code={error.code || 'TEMPO_ERROR'}
        />
      )}

      {loading && !trace && (
        <GlassCard className="flex min-h-48 items-center justify-center p-8">
          <div className="flex items-center gap-2.5 text-xs text-white/50">
            <span className="live-dot is-signal" />
            Loading trace from Tempo...
          </div>
        </GlassCard>
      )}

      {trace && trace.spans.length === 0 && (
        <EmptyState
          icon={Layers}
          title="Trace contains no spans"
          description="The analysis engine refused to fabricate a waterfall."
          className="py-16"
        />
      )}

      {trace && trace.spans.length > 0 && (
        <>
          <GlassCard className="p-4 sm:p-6">
            <CardHeader
              icon={Layers}
              eyebrow="Span timeline"
              title="Span waterfall"
              description={`${trace.totalSpans} spans · ${trace.totalDurationMs.toFixed(1)}ms total duration`}
              action={<StatusBadge status={errorSpans > 0 ? 'ERROR' : 'OK'} label={errorSpans > 0 ? `${errorSpans} errors` : 'No span errors'} />}
            />

            <div className="mt-4 space-y-2">
              {trace.spans.map((span) => {
                const leftPercent = trace.totalDurationMs > 0
                  ? (span.startOffsetMs / trace.totalDurationMs) * 100
                  : 0;
                const widthPercent = trace.totalDurationMs > 0
                  ? Math.max(1.5, (span.durationMs / trace.totalDurationMs) * 100)
                  : 100;
                const isError = span.statusCode === 'ERROR';
                const isSelected = selectedSpan?.spanId === span.spanId;

                return (
                  <button
                    key={span.spanId}
                    type="button"
                    onClick={() => setSelectedSpan(span)}
                    className={cn(
                      'block w-full rounded-lg border p-3 text-left transition duration-200',
                      isSelected
                        ? 'border-signal-400/35 bg-signal-500/[0.07]'
                        : 'border-white/[0.065] bg-white/[0.025] hover:border-white/12 hover:bg-white/[0.045]'
                    )}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={cn(
                          'h-1.5 w-1.5 shrink-0 rounded-full',
                          isError ? 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.6)]' : 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.45)]'
                        )} />
                        <span className="min-w-0 truncate text-[12px] font-semibold text-white/84">{span.name}</span>
                        <span className="hidden shrink-0 sm:inline-flex">
                          <Badge>{span.service}</Badge>
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-white/44">
                        <span>duration <strong className="font-semibold text-white/70">{span.durationMs}ms</strong></span>
                        <span>self <strong className="font-semibold text-signal-300">{span.selfTimeMs}ms</strong></span>
                      </div>
                    </div>
                    <div className="relative mt-2.5 h-2 overflow-hidden rounded-full bg-inset">
                      <div
                        style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
                        className={cn(
                          'absolute inset-y-0 rounded-full transition-[width,left] duration-500',
                          isError
                            ? 'bg-gradient-to-r from-rose-500 to-red-600 shadow-[0_0_12px_rgba(244,63,94,0.45)]'
                            : 'bg-gradient-to-r from-signal-400 to-signal-600 shadow-[0_0_12px_rgba(94,105,209,0.35)]'
                        )}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 sm:hidden">
                      <Badge>{span.service}</Badge>
                      <span className="text-[10px] text-white/40">Tap for span inspector</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </GlassCard>

          {selectedSpan && !compact && (
            <GlassCard className="p-5">
              <CardHeader icon={Zap} eyebrow="Selected span" title="Span inspector" />
              <div className="mt-4">{spanInspector}</div>
            </GlassCard>
          )}

          <BottomSheet
            open={Boolean(selectedSpan) && compact}
            onClose={() => setSelectedSpan(null)}
            eyebrow="Selected span"
            title="Span inspector"
            footer={
              <Button variant="secondary" className="w-full" onClick={() => setSelectedSpan(null)}>
                Close inspector
              </Button>
            }
          >
            {spanInspector}
          </BottomSheet>
        </>
      )}
    </div>
  );
}
