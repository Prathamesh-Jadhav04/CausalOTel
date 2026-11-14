import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Activity,
  CheckCircle2,
  Clock,
  Database,
  RefreshCw,
  Server,
  ShoppingCart
} from 'lucide-react';
import api from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import {
  describeApiError,
  normalizeIncidentList,
  normalizeServiceHealth
} from '../lib/contracts.js';
import { rcaDetailPath } from '../lib/routes.js';
import {
  Badge,
  Button,
  CardHeader,
  CopyButton,
  ErrorBanner,
  GlassCard,
  LoadingBlock,
  MetaChip,
  PageHeader,
  ProgressRing,
  StatCard,
  StatusBadge,
  cn,
  useMediaQuery
} from '../components/ui.jsx';

export default function Overview() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(null);
  const [incidents, setIncidents] = useState(null);
  const [incidentsError, setIncidentsError] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [analysisError, setAnalysisError] = useState(null);
  const [product, setProduct] = useState(null);
  const [productError, setProductError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState(null);
  const narrow = useMediaQuery('(max-width: 379px)');

  const load = async () => {
    setLoading(true);

    const [healthResult, incidentResult, analysisResult, productResult] = await Promise.allSettled([
      api.get('/api/analysis/services'),
      api.get('/api/analysis/incidents', { params: { limit: 200 } }),
      api.get('/api/analysis'),
      api.get('/api/products')
    ]);

    if (healthResult.status === 'fulfilled') {
      setHealth(normalizeServiceHealth(healthResult.value.data));
      setHealthError(null);
    } else {
      setHealth(null);
      setHealthError(describeApiError(healthResult.reason));
    }

    if (incidentResult.status === 'fulfilled') {
      setIncidents(normalizeIncidentList(incidentResult.value.data));
      setIncidentsError(null);
    } else {
      setIncidents(null);
      setIncidentsError(describeApiError(incidentResult.reason));
    }

    if (analysisResult.status === 'fulfilled') {
      setAnalysis(analysisResult.value.data);
      setAnalysisError(null);
    } else {
      setAnalysis(null);
      setAnalysisError(describeApiError(analysisResult.reason));
    }

    if (productResult.status === 'fulfilled') {
      const products = Array.isArray(productResult.value.data) ? productResult.value.data : [];
      const inStock = products.find(item => Number(item.stock_quantity) > 0);
      setProduct(inStock || null);
      setProductError(inStock ? null : { detail: 'No in-stock product is available in the catalog.' });
    } else {
      setProduct(null);
      setProductError(describeApiError(productResult.reason));
    }

    setLoading(false);
    setLastLoadedAt(new Date());
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeIncidents = incidents ? incidents.filter(incident => incident.status === 'ACTIVE') : null;
  const latestIncident = incidents?.[0] || null;
  const serviceRows = health?.services || [];
  const upCount = health?.upCount ?? 0;
  const totalCount = health?.totalCount ?? 0;
  const healthRatio = totalCount > 0 ? upCount / totalCount : 0;

  const statusLabel = healthError
    ? 'Health probes degraded'
    : incidentsError
      ? 'Incident store unavailable'
      : analysisError
        ? 'Analysis engine unavailable'
        : activeIncidents?.length
          ? 'Active incident detected'
          : health && totalCount > 0 && upCount === totalCount
            ? 'All probed services online'
            : health
              ? 'Partial service availability'
              : 'Awaiting live telemetry';

  const statusDetail = healthError
    ? healthError.detail
    : incidentsError
      ? incidentsError.detail
      : analysisError
        ? analysisError.detail
        : latestIncident
          ? `${latestIncident.culpritService} · ${latestIncident.rootCauseType}`
          : health
            ? `${upCount} of ${totalCount} live probes passing${health.checkedAt ? ` · checked ${new Date(health.checkedAt).toLocaleTimeString()}` : ''}`
            : 'Connect the local stack to populate live health probes.';

  const handleQuickCheckout = async () => {
    if (!product) {
      return;
    }
    setCheckoutLoading(true);
    setCheckoutResult(null);
    try {
      const response = await api.post('/api/orders/checkout', {
        userId: session.userId,
        items: [{
          productId: String(product.id),
          sku: product.sku,
          quantity: 1
        }],
        idempotencyKey: `idem-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`
      });
      setCheckoutResult({ success: true, data: response.data });
      load();
    } catch (err) {
      setCheckoutResult({ success: false, error: describeApiError(err) });
    } finally {
      setCheckoutLoading(false);
    }
  };

  return (
    <div className="space-y-5 lg:space-y-6">
      <PageHeader
        eyebrow="Live system pulse"
        title="System overview"
        description="Live probes, recorded incidents, and real checkout execution. No mock operational data."
        actions={
          <Button onClick={load} loading={loading} variant="secondary">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            {loading ? 'Refreshing' : 'Refresh'}
          </Button>
        }
        meta={
          <>
            <MetaChip icon={Activity}>Real-time observability</MetaChip>
            <MetaChip icon={Server}>{health ? `${upCount}/${totalCount} services online` : 'Probing services'}</MetaChip>
            <MetaChip icon={Clock}>{lastLoadedAt ? `updated ${lastLoadedAt.toLocaleTimeString()}` : 'Awaiting load'}</MetaChip>
          </>
        }
      />

      <GlassCard className="relative overflow-hidden p-5 sm:p-6 stagger-1 animate-fade-up">
        <div className="signal-sheen pointer-events-none absolute inset-0" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-3.5 sm:gap-5">
            <ProgressRing
              ratio={healthRatio}
              display={health ? `${upCount}/${totalCount}` : '—'}
              caption="online"
              tone={healthError ? 'amber' : 'emerald'}
              size={narrow ? 88 : 100}
              stroke={narrow ? 7 : 8}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('live-dot', healthError || incidentsError ? 'is-signal' : '')} />
                <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-white/48">
                  {loading ? 'Syncing live state' : 'Current state'}
                </span>
                {activeIncidents?.length > 0 && <Badge tone="rose" dot>{activeIncidents.length} ACTIVE</Badge>}
              </div>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl">{statusLabel}</h2>
              <p className="mt-1.5 max-w-xl text-xs leading-relaxed text-white/52">{statusDetail}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <MetaChip icon={Database}>{incidents ? `${incidents.length} recorded` : 'Store loading'}</MetaChip>
                <MetaChip icon={Activity}>{analysisError ? 'Engine unavailable' : analysis?.status || 'Engine unknown'}</MetaChip>
              </div>
            </div>
          </div>

          <div className="w-full shrink-0 xl:w-[320px]">
            <div className="glass-inset rounded-lg p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-white/42">Latest incident</p>
                {latestIncident && <StatusBadge status={latestIncident.severity} />}
              </div>
              {incidentsError ? (
                <p className="mt-3 text-xs leading-relaxed text-rose-200/75">Incident store unavailable: {incidentsError.detail}</p>
              ) : latestIncident ? (
                <button
                  type="button"
                  onClick={() => navigate(rcaDetailPath(latestIncident.incidentId))}
                  className="mt-3 block w-full text-left"
                >
                  <p className="font-mono text-sm font-semibold text-white/90">{latestIncident.culpritService}</p>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-white/50">{latestIncident.summary}</p>
                  <span className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-signal-300">
                    Inspect RCA <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </button>
              ) : (
                <p className="mt-3 text-xs leading-relaxed text-white/46">
                  {loading ? 'Loading incident records...' : 'No incident records exist yet. Analyze a real Tempo trace to produce the first root cause.'}
                </p>
              )}
            </div>
          </div>
        </div>
      </GlassCard>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard
          label="Services online"
          value={health ? `${upCount} / ${totalCount}` : '—'}
          hint={healthError ? 'Probe unavailable' : 'Live health probes'}
          icon={CheckCircle2}
          tone="emerald"
          className="stagger-1 animate-fade-up"
        />
        <StatCard
          label="Active incidents"
          value={activeIncidents ? activeIncidents.length : '—'}
          hint={incidentsError ? 'Store unavailable' : latestIncident ? latestIncident.rootCauseType : 'None recorded'}
          icon={AlertTriangle}
          tone="rose"
          className="stagger-2 animate-fade-up"
        />
        <StatCard
          label="Recorded incidents"
          value={incidents ? incidents.length : '—'}
          hint="Durable disk spool"
          icon={Database}
          tone="signal"
          className="stagger-3 animate-fade-up"
        />
        <StatCard
          label="Analysis engine"
          value={analysisError ? 'UNAVAILABLE' : analysis?.status || '—'}
          hint={analysis ? `${analysis.pendingIncidentsCount} pending` : analysisError?.detail || 'No analysis state'}
          icon={Activity}
          tone="amber"
          compact
          className="stagger-4 animate-fade-up"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 lg:gap-5">
        <GlassCard className="p-4 sm:p-6 xl:col-span-2">
          <CardHeader
            icon={Server}
            eyebrow="Service mesh"
            title="Microservices health matrix"
            description="Live /health/live probe results from the analysis engine."
            action={
              <button
                type="button"
                onClick={() => navigate('/services')}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/54 transition hover:text-signal-300"
              >
                View details <ArrowRight className="h-3.5 w-3.5" />
              </button>
            }
          />

          <div className="mt-4">
            {healthError ? (
              <ErrorBanner title="Health probe failed" detail={healthError.detail} />
            ) : serviceRows.length === 0 ? (
              <div className="glass-inset rounded-lg p-4 text-xs text-white/50">
                {loading ? 'Probing services...' : 'No services reported by the probe.'}
              </div>
            ) : (
              <div className="divide-y divide-white/[0.055]">
                {serviceRows.map((svc) => (
                  <div key={svc.name} className="flex min-w-0 items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <span className={cn(
                      'h-2 w-2 shrink-0 rounded-full',
                      svc.status === 'UP'
                        ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.55)]'
                        : svc.status === 'DOWN'
                          ? 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.5)]'
                          : 'bg-rose-400 shadow-[0_0_12px_rgba(251,113,133,0.5)]'
                    )} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-semibold text-white/84">{svc.name}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-white/40">Port :{svc.port}</p>
                    </div>
                    <span className="hidden font-mono text-[10px] text-white/50 sm:block">
                      {svc.latencyMs === null ? '—' : `${svc.latencyMs}ms`}
                    </span>
                    <StatusBadge status={svc.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </GlassCard>

        <GlassCard className="flex flex-col p-4 sm:p-6">
          <CardHeader
            icon={ShoppingCart}
            eyebrow="Live transaction"
            title="Checkout saga"
            description="Order → inventory reserve → payment charge → inventory commit."
          />

          <div className="mt-4">
            {productError ? (
              <ErrorBanner title="Catalog unavailable" detail={productError.detail} />
            ) : product ? (
              <div className="glass-inset rounded-lg p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[11px] font-semibold text-white/78">{product.sku}</span>
                  <span className="text-sm font-semibold text-white">${(Number(product.price_cents) / 100).toFixed(2)}</span>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px]">
                  <span className="min-w-0 truncate text-white/54">{product.name}</span>
                  <span className="shrink-0 text-white/40">Qty 1</span>
                </div>
              </div>
            ) : (
              <div className="glass-inset rounded-lg p-3.5 text-xs text-white/46">
                {loading ? 'Loading catalog...' : 'No product available.'}
              </div>
            )}

            {checkoutResult && (
              <div className={cn(
                'mt-3 rounded-lg border p-3.5 text-xs',
                checkoutResult.success
                  ? 'border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-200'
                  : 'border-rose-400/20 bg-rose-400/[0.07] text-rose-200'
              )}>
                {checkoutResult.success ? (
                  <div className="space-y-1">
                    <span className="block font-semibold">Order {checkoutResult.data.status}</span>
                    <span className="flex items-center gap-1.5 break-all font-mono text-[10px] text-emerald-200/65">
                      ID: {checkoutResult.data.orderId}
                      <CopyButton compact value={checkoutResult.data.orderId} label="Copy order ID" />
                    </span>
                    <span className="flex items-center gap-1.5 break-all font-mono text-[10px] text-emerald-200/65">
                      Payment: {checkoutResult.data.paymentId}
                      <CopyButton compact value={checkoutResult.data.paymentId} label="Copy payment ID" />
                    </span>
                  </div>
                ) : (
                  <div>
                    <span className="block font-semibold">
                      Checkout failed {checkoutResult.error.status ? `(HTTP ${checkoutResult.error.status})` : ''}
                    </span>
                    <span className="mt-1 block leading-relaxed text-rose-200/72">{checkoutResult.error.detail}</span>
                    <button
                      type="button"
                      onClick={() => navigate('/incidents')}
                      className="mt-2 inline-flex items-center gap-1 font-semibold text-signal-300 underline decoration-signal-400/30 underline-offset-2"
                    >
                      View recorded incidents <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <Button
            onClick={handleQuickCheckout}
            disabled={checkoutLoading || !product}
            loading={checkoutLoading}
            variant="primary"
            className="mt-5 w-full"
          >
            {checkoutLoading ? 'Executing saga' : 'Trigger checkout saga'}
          </Button>
        </GlassCard>
      </div>

      {loading && !health && !incidents && !analysis && (
        <LoadingBlock label="Contacting the local observability stack..." />
      )}
    </div>
  );
}
