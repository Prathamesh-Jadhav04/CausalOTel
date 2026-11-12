import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Code,
  Cpu,
  GitCommit,
  Layers,
  RefreshCw,
  Sparkles
} from 'lucide-react';
import api from '../lib/api.js';
import { describeApiError, normalizeIncident, normalizeIncidentList } from '../lib/contracts.js';
import { traceDetailPath } from '../lib/routes.js';
import {
  Badge,
  Button,
  CardHeader,
  EmptyState,
  ErrorBanner,
  GlassCard,
  IconButton,
  MetaChip,
  Notice,
  PageHeader,
  ProgressRing,
  StatusBadge,
  cn
} from '../components/ui.jsx';

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  const data = incident;
  const evidence = data?.evidence || [];
  const causalPath = data?.causalPath || [];
  const remediations = data?.remediations || [];

  return (
    <div className="space-y-5 lg:space-y-6">
      <button
        type="button"
        onClick={() => navigate('/incidents')}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/50 transition hover:text-white/78"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to incidents
      </button>

      <PageHeader
        eyebrow="Root cause analysis"
        title={
          <span className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
            <span>Incident evidence</span>
            {data && <span className="break-all font-mono text-[11px] font-normal tracking-normal text-white/44 sm:text-sm">{data.incidentId}</span>}
          </span>
        }
        description="Recorded incident detail from real Tempo spans and Prometheus correlation."
        actions={
          <>
            <IconButton label="Reload incident" onClick={load} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </IconButton>
            {data && (
              <Button variant="secondary" onClick={() => setShowJson(!showJson)}>
                <Code className="h-4 w-4" />
                {showJson ? 'Hide raw JSON' : 'View raw JSON'}
              </Button>
            )}
          </>
        }
        meta={data ? (
          <>
            <StatusBadge status={data.severity} />
            <StatusBadge status={data.status} />
            <MetaChip>{data.rootCauseType}</MetaChip>
            {data.createdAt && <MetaChip icon={Clock}>{new Date(data.createdAt).toLocaleString()}</MetaChip>}
          </>
        ) : null}
      />

      {loading && !data && (
        <GlassCard className="flex min-h-48 items-center justify-center p-8">
          <div className="flex items-center gap-2.5 text-xs text-white/50">
            <span className="live-dot is-signal" />
            Loading incident record...
          </div>
        </GlassCard>
      )}

      {error && (
        <ErrorBanner
          title="Incident unavailable"
          detail={error.detail}
          code={error.code || 'ERROR'}
        />
      )}

      {!loading && !error && !data && (
        <EmptyState
          icon={Layers}
          title="No incident records exist"
          description="Analyze a real Tempo trace to produce the first root cause incident."
          action={
            <Button variant="primary" onClick={() => navigate('/traces')}>
              Browse traces <ArrowRight className="h-4 w-4" />
            </Button>
          }
          className="py-16"
        />
      )}

      {data && (
        <>
          <GlassCard className="relative overflow-hidden p-4 sm:p-6">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_150%_at_0%_0%,rgba(255,45,85,0.17),transparent_56%)]" />
            <div className="relative flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="rose" dot>{data.severity} root cause</Badge>
                  {data.traceId && (
                    <button
                      type="button"
                      onClick={() => navigate(traceDetailPath(data.traceId))}
                      className="inline-flex max-w-full items-center gap-1.5 break-all text-left font-mono text-[10px] text-white/50 underline decoration-white/15 underline-offset-2 transition hover:text-signal-300"
                    >
                      trace {data.traceId}
                    </button>
                  )}
                </div>

                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-white/40">Culprit service</p>
                  <h2 className="mt-1 break-all font-mono text-2xl font-semibold tracking-[-0.03em] text-signal-300 sm:text-3xl">
                    {data.culpritService}
                  </h2>
                </div>

                <p className="max-w-2xl text-[13px] leading-relaxed text-white/66">{data.summary}</p>
                <p className="break-all font-mono text-[10px] text-white/40">Root cause type: {data.rootCauseType}</p>
              </div>

              <div className="flex shrink-0 items-center gap-4 self-start rounded-3xl border border-white/[0.07] bg-black/25 p-3.5 sm:gap-6 sm:p-4 xl:self-auto">
                <ProgressRing
                  ratio={data.confidenceScore ?? 0}
                  display={data.confidenceScore === null ? '—' : `${(data.confidenceScore * 100).toFixed(0)}%`}
                  caption="confidence"
                  tone={data.confidenceScore !== null && data.confidenceScore >= 0.7 ? 'emerald' : 'amber'}
                  size={88}
                  stroke={7}
                />
                <div className="h-12 w-px bg-white/[0.08]" />
                <div className="text-center">
                  <p className="text-2xl font-semibold leading-none tracking-[-0.04em] text-white">{evidence.length}</p>
                  <p className="mt-1.5 text-[8px] font-semibold uppercase tracking-[0.16em] text-white/42">Evidence signals</p>
                </div>
              </div>
            </div>
          </GlassCard>

          {!data.metricsAvailable && (
            <Notice tone="warning">
              <p className="font-semibold">Prometheus correlation unavailable</p>
              <p className="mt-1 text-[11px] opacity-75">
                {data.metricsError?.message || data.metricsError?.code || 'Metrics were not available during analysis.'}{' '}
                Confidence is based on trace evidence only.
              </p>
            </Notice>
          )}

          <GlassCard className="p-4 sm:p-6">
            <CardHeader
              icon={GitCommit}
              eyebrow="Propagation"
              title="Causal path"
              description="Service hops recorded by the analysis engine for this incident."
              action={<Badge tone="signal">{causalPath.length} hops</Badge>}
            />
            {causalPath.length === 0 ? (
              <div className="glass-inset mt-4 rounded-2xl p-4 text-xs text-white/46">
                The analysis engine recorded no causal path for this incident.
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-stretch">
                {causalPath.map((step, index) => {
                  const isCulprit = step.service === data.culpritService;
                  return (
                    <React.Fragment key={`${step.service}-${index}`}>
                      <div
                        className={cn(
                          'min-w-0 flex-1 rounded-2xl border p-3.5 transition',
                          isCulprit
                            ? 'border-signal-400/30 bg-signal-500/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                            : 'border-white/[0.065] bg-white/[0.028]'
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[8px] font-semibold uppercase tracking-[0.16em] text-white/40">Hop {index + 1}</span>
                          <StatusBadge status={step.status} />
                        </div>
                        <p className={cn('mt-2 break-all font-mono text-[13px] font-semibold', isCulprit ? 'text-signal-200' : 'text-white/78')}>
                          {step.service}
                        </p>
                        <p className="mt-1 font-mono text-[10px] text-white/44">{step.latency}</p>
                      </div>
                      {index < causalPath.length - 1 && (
                        <div className="flex shrink-0 items-center justify-center md:w-6">
                          <ArrowDown className="h-4 w-4 text-white/30 md:hidden" />
                          <ArrowRight className="hidden h-4 w-4 text-white/30 md:block" />
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </GlassCard>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
            <GlassCard className="p-4 sm:p-6">
              <CardHeader
                icon={Activity}
                eyebrow="Signals"
                title="Causal evidence chain"
                action={<Badge tone={evidence.length ? 'emerald' : 'neutral'}>{evidence.length} signals</Badge>}
              />
              {evidence.length === 0 ? (
                <div className="glass-inset mt-4 rounded-2xl p-4 text-xs text-white/46">
                  No evidence signals were recorded.
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  {evidence.map((item, index) => (
                    <div
                      key={`${item.type}-${index}`}
                      className="flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3.5"
                    >
                      <span className="mt-0.5 shrink-0">
                        {item.severity === 'CRITICAL' ? (
                          <AlertTriangle className="h-4 w-4 text-rose-400" />
                        ) : item.severity === 'HIGH' ? (
                          <AlertTriangle className="h-4 w-4 text-amber-400" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="break-all font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-white/70">{item.type}</span>
                          {item.value !== undefined && item.value !== null && (
                            <span className="break-all font-mono text-[10px] font-medium text-signal-300">{String(item.value)}</span>
                          )}
                        </div>
                        <p className="break-words text-[11px] leading-relaxed text-white/50">{item.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>

            <div className="space-y-4 lg:space-y-5">
              <GlassCard className="p-4 sm:p-6">
                <CardHeader icon={Cpu} eyebrow="Timing" title="Sweep-line interval union" />
                {data.sweepLineMetrics ? (
                  <dl className="mt-4 space-y-1 rounded-2xl border border-white/[0.06] bg-black/20 p-3.5 font-mono text-[11px]">
                    <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] py-1.5">
                      <dt className="text-white/46">Total span duration</dt>
                      <dd className="text-white/78">{data.sweepLineMetrics.totalSpanDurationMs} ms</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] py-1.5">
                      <dt className="text-white/46">Child spans overlap</dt>
                      <dd className="text-white/78">{data.sweepLineMetrics.childSpansOverlapMs} ms</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] py-1.5">
                      <dt className="text-white/46">Net exclusive self-time</dt>
                      <dd className="font-semibold text-signal-300">{data.sweepLineMetrics.netSelfTimeMs} ms</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 py-1.5 text-[10px]">
                      <dt className="text-white/36">Engine implementation</dt>
                      <dd className="text-signal-300/75">{data.sweepLineMetrics.engineUsed}</dd>
                    </div>
                  </dl>
                ) : (
                  <div className="glass-inset mt-4 rounded-2xl p-4 text-xs text-white/46">
                    No sweep-line metrics were recorded for this incident.
                  </div>
                )}
              </GlassCard>

              <GlassCard className="p-4 sm:p-6">
                <CardHeader icon={Sparkles} eyebrow="Recommended" title="Automated remediation actions" />
                {remediations.length === 0 ? (
                  <div className="glass-inset mt-4 rounded-2xl p-4 text-xs text-white/46">
                    No remediation recommendation was recorded.
                  </div>
                ) : (
                  <ul className="mt-4 space-y-2">
                    {remediations.map((action, index) => (
                      <li
                        key={`${action}-${index}`}
                        className="flex items-start gap-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3 text-[11px] leading-relaxed text-white/62"
                      >
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-signal-400/25 bg-signal-500/10 text-[9px] font-bold text-signal-300">
                          {index + 1}
                        </span>
                        <span className="mt-0.5 break-words">{action}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </GlassCard>
            </div>
          </div>

          {showJson && (
            <GlassCard className="p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/42">Recorded incident JSON</p>
                <Badge tone="neutral">raw payload</Badge>
              </div>
              <pre className="mt-3 max-h-[480px] overflow-auto rounded-2xl border border-white/[0.06] bg-black/30 p-4 font-mono text-[10px] leading-relaxed text-emerald-300/80">
                {JSON.stringify(data, null, 2)}
              </pre>
            </GlassCard>
          )}
        </>
      )}
    </div>
  );
}
