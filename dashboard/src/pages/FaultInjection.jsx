import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Database,
  Package,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShoppingCart,
  Zap
} from 'lucide-react';
import api from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import {
  describeApiError,
  faultResetRequests,
  inventoryFaultPayload,
  paymentFaultPayload
} from '../lib/contracts.js';
import {
  Badge,
  Button,
  CardHeader,
  CopyButton,
  GlassCard,
  MetaChip,
  Notice,
  PageHeader,
  StatusBadge,
  cn
} from '../components/ui.jsx';

const faultScenarios = [
  {
    id: 'pay-latency',
    target: 'payment-service',
    title: 'Payment Gateway Latency (3s)',
    description: 'Adds a 3,000ms delay to payment charges. Tests checkout timeout handling and sweep-line self-time attribution.',
    severity: 'MEDIUM',
    icon: CreditCard,
    buildPayload: () => paymentFaultPayload({ latencyMs: 3000, faultMode: 'LATENCY' })
  },
  {
    id: 'pay-timeout',
    target: 'payment-service',
    title: 'Payment Gateway Timeout (504)',
    description: 'Returns HTTP 504 from the simulated gateway. Tests saga compensation and RCA culprit ranking.',
    severity: 'HIGH',
    icon: CreditCard,
    buildPayload: () => paymentFaultPayload({ latencyMs: 0, faultMode: 'GATEWAY_TIMEOUT' })
  },
  {
    id: 'pay-declined',
    target: 'payment-service',
    title: 'Card Processor Declined (422)',
    description: 'Simulates an unprocessable payment decline. Tests order rollback and RFC 9457 error propagation.',
    severity: 'LOW',
    icon: CreditCard,
    buildPayload: () => paymentFaultPayload({ latencyMs: 0, faultMode: 'DECLINED' })
  },
  {
    id: 'pay-down',
    target: 'payment-service',
    title: 'Payment Service Outage (503)',
    description: 'Returns HTTP 503 from the simulated gateway. Tests catastrophic downstream failure handling.',
    severity: 'CRITICAL',
    icon: CreditCard,
    buildPayload: () => paymentFaultPayload({ latencyMs: 0, faultMode: 'GATEWAY_DOWN' })
  },
  {
    id: 'inv-latency',
    target: 'inventory-service',
    title: 'Inventory Reservation Latency (3s)',
    description: 'Adds a 3,000ms delay to inventory operations. Tests saga timeouts and latency attribution.',
    severity: 'MEDIUM',
    icon: Package,
    buildPayload: () => inventoryFaultPayload({ latencyMs: 3000 })
  },
  {
    id: 'inv-busy',
    target: 'inventory-service',
    title: 'SQLite Busy Lock',
    description: 'Throws a simulated SQLITE_BUSY lock error. Tests reservation failure and compensation paths.',
    severity: 'HIGH',
    icon: Database,
    buildPayload: () => inventoryFaultPayload({ simulateBusy: true })
  },
  {
    id: 'inv-error',
    target: 'inventory-service',
    title: 'Inventory Internal Error (500)',
    description: 'Throws a simulated internal inventory error. Tests upstream failure propagation and RCA.',
    severity: 'HIGH',
    icon: Database,
    buildPayload: () => inventoryFaultPayload({
      simulateError: true,
      errorMessage: 'Simulated inventory backend failure'
    })
  }
];

export default function FaultInjection() {
  const navigate = useNavigate();
  const { session, isAdmin } = useAuth();
  const [paymentFault, setPaymentFault] = useState(null);
  const [inventoryFault, setInventoryFault] = useState(null);
  const [faultError, setFaultError] = useState(null);
  const [statusMessage, setStatusMessage] = useState(null);
  const [loadingFaultId, setLoadingFaultId] = useState(null);
  const [loadingState, setLoadingState] = useState(true);
  const [product, setProduct] = useState(null);
  const [productError, setProductError] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState(null);

  const loadFaultState = async () => {
    setLoadingState(true);
    setFaultError(null);
    try {
      const [paymentResponse, inventoryResponse] = await Promise.all([
        api.get('/api/payments/fault'),
        api.get('/api/inventory/fault')
      ]);
      setPaymentFault(paymentResponse.data);
      setInventoryFault(inventoryResponse.data);
    } catch (err) {
      setPaymentFault(null);
      setInventoryFault(null);
      setFaultError(describeApiError(err));
    } finally {
      setLoadingState(false);
    }
  };

  const loadProduct = async () => {
    try {
      const response = await api.get('/api/products');
      const products = Array.isArray(response.data) ? response.data : [];
      const inStock = products.find(item => Number(item.stock_quantity) > 0) || null;
      setProduct(inStock);
      setProductError(inStock ? null : { detail: 'No in-stock product is available in the catalog.' });
    } catch (err) {
      setProduct(null);
      setProductError(describeApiError(err));
    }
  };

  useEffect(() => {
    if (isAdmin) {
      loadFaultState();
      loadProduct();
    } else {
      setLoadingState(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const refreshFaultState = () => {
    loadFaultState();
    loadProduct();
  };

  const injectFault = async (scenario) => {
    setLoadingFaultId(scenario.id);
    setStatusMessage(null);
    try {
      const endpoint = scenario.target === 'payment-service'
        ? '/api/payments/fault'
        : '/api/inventory/fault';
      await api.post(endpoint, scenario.buildPayload());
      await loadFaultState();
      setStatusMessage({ type: 'success', text: `Applied fault: ${scenario.title}` });
    } catch (err) {
      const described = describeApiError(err);
      setStatusMessage({
        type: 'error',
        text: `Fault injection failed${described.status ? ` (HTTP ${described.status})` : ''}: ${described.detail}`
      });
    } finally {
      setLoadingFaultId(null);
    }
  };

  const resetAllFaults = async () => {
    setStatusMessage(null);
    try {
      for (const request of faultResetRequests()) {
        await api.post(request.endpoint, request.body);
      }
      await loadFaultState();
      setStatusMessage({ type: 'success', text: 'Payment and inventory fault state reset to NORMAL.' });
    } catch (err) {
      const described = describeApiError(err);
      setStatusMessage({
        type: 'error',
        text: `Reset failed${described.status ? ` (HTTP ${described.status})` : ''}: ${described.detail}`
      });
    }
  };

  const triggerTestCheckout = async () => {
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
        idempotencyKey: `idem-fault-${Date.now()}-${Math.random().toString(36).slice(2)}`
      });
      setCheckoutResult({ success: true, data: response.data });
    } catch (err) {
      setCheckoutResult({ success: false, error: describeApiError(err) });
    } finally {
      setCheckoutLoading(false);
    }
  };

  const activeFaults = [];
  if (paymentFault && (paymentFault.faultMode !== 'NORMAL' || Number(paymentFault.latencyMs) > 0)) {
    activeFaults.push({
      target: 'payment-service',
      label: `${paymentFault.faultMode}${Number(paymentFault.latencyMs) > 0 ? ` + ${paymentFault.latencyMs}ms` : ''}`
    });
  }
  if (inventoryFault && (
    Number(inventoryFault.latencyMs) > 0 || inventoryFault.simulateBusy || inventoryFault.simulateError
  )) {
    const parts = [];
    if (Number(inventoryFault.latencyMs) > 0) parts.push(`${inventoryFault.latencyMs}ms latency`);
    if (inventoryFault.simulateBusy) parts.push('SQLITE_BUSY');
    if (inventoryFault.simulateError) parts.push('internal error');
    activeFaults.push({ target: 'inventory-service', label: parts.join(' + ') });
  }

  if (!isAdmin) {
    return (
      <div className="space-y-5 lg:space-y-6">
        <PageHeader
          eyebrow="Admin controls"
          title="Fault injection"
          description="Fault injection mutates payment and inventory behavior."
          meta={<MetaChip icon={ShieldAlert}>ROLE_ADMIN required</MetaChip>}
        />
        <GlassCard className="relative overflow-hidden p-8 text-center sm:p-12">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_120%_at_50%_0%,rgba(251,191,36,0.12),transparent_60%)]" />
          <div className="relative mx-auto flex max-w-md flex-col items-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl border border-amber-400/20 bg-amber-400/[0.08] text-amber-300">
              <ShieldAlert className="h-6 w-6" />
            </span>
            <p className="mt-4 text-base font-semibold text-white/90">Administrator role required</p>
            <p className="mt-1.5 text-xs leading-relaxed text-white/50">
              Your session role is <span className="font-mono text-white/70">{session?.role}</span>. Both payment and
              inventory fault endpoints require <span className="font-mono text-amber-300">ROLE_ADMIN</span>.
            </p>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-5 lg:space-y-6">
      <PageHeader
        eyebrow="Admin controls"
        title="Fault injection"
        description="Bounded, audited, admin-only fault modes. State is read back from each service after every change."
        actions={
          <>
            <Button onClick={refreshFaultState} disabled={loadingState} variant="secondary">
              <RefreshCw className={cn('h-4 w-4', loadingState && 'animate-spin')} />
              Refresh state
            </Button>
            <Button onClick={resetAllFaults} variant="secondary">
              <RotateCcw className="h-4 w-4" />
              Reset all faults
            </Button>
          </>
        }
        meta={<MetaChip icon={ShieldAlert}>ROLE_ADMIN session</MetaChip>}
      />

      {statusMessage && (
        <Notice tone={statusMessage.type === 'success' ? 'success' : 'error'}>
          {statusMessage.text}
        </Notice>
      )}

      {faultError && (
        <Notice tone="error">
          <p className="font-semibold">Fault state unavailable ({faultError.code || 'ERROR'})</p>
          <p className="mt-1 text-[11px] opacity-75">{faultError.detail}</p>
          <p className="mt-1 text-[10px] opacity-60">Fault injection may be disabled by configuration on one or both services.</p>
        </Notice>
      )}

      <GlassCard className="p-4 sm:p-5">
        <CardHeader
          icon={ShieldAlert}
          eyebrow="Live fault state"
          title="Active injected faults"
          description="Read back directly from payment and inventory services."
          action={loadingState ? <span className="live-dot is-signal" /> : <Badge tone={activeFaults.length ? 'rose' : 'emerald'} dot>{activeFaults.length ? 'FAULTS ACTIVE' : 'NORMAL'}</Badge>}
        />
        <div className="mt-4">
          {loadingState ? (
            <p className="text-xs text-white/46 animate-pulse">Reading fault state...</p>
          ) : faultError ? (
            <p className="text-xs text-white/46">Unavailable until the fault endpoints respond.</p>
          ) : activeFaults.length === 0 ? (
            <div className="flex items-center gap-2 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.055] px-3.5 py-3 text-[11px] text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Payment and inventory services report NORMAL operation.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {activeFaults.map((fault) => (
                <span
                  key={fault.target}
                  className="inline-flex max-w-full items-center gap-2 rounded-2xl border border-rose-400/20 bg-rose-500/[0.075] px-3 py-2 text-[11px] text-rose-200"
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-300" />
                  <span className="break-all font-mono font-semibold">{fault.target}:</span>
                  <span className="break-all">{fault.label}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </GlassCard>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 lg:gap-4">
        {faultScenarios.map((scenario, index) => {
          const Icon = scenario.icon;
          const isLoading = loadingFaultId === scenario.id;
          return (
            <GlassCard
              key={scenario.id}
              interactive
              className={cn('flex flex-col p-4 sm:p-5', index < 3 ? 'stagger-1' : 'stagger-2', 'animate-fade-up')}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/[0.08] bg-gradient-to-br from-white/[0.08] to-white/[0.02] text-white/62">
                  <Icon className="h-4 w-4" />
                </span>
                <StatusBadge status={scenario.severity} />
              </div>

              <h2 className="mt-3 text-[13px] font-semibold leading-snug text-white/88">{scenario.title}</h2>
              <p className="mt-1 break-all font-mono text-[10px] text-signal-300/70">Target: {scenario.target}</p>
              <p className="mt-2 text-[11px] leading-relaxed text-white/48">{scenario.description}</p>

              <Button
                onClick={() => injectFault(scenario)}
                disabled={isLoading || Boolean(faultError)}
                loading={isLoading}
                variant="danger"
                className="mt-4 w-full"
              >
                <Zap className="h-3.5 w-3.5" />
                {isLoading ? 'Injecting' : 'Inject this fault'}
              </Button>
            </GlassCard>
          );
        })}
      </div>

      <GlassCard className="p-4 sm:p-6">
        <CardHeader
          icon={ShoppingCart}
          eyebrow="End-to-end test"
          title="Trigger checkout saga under current fault state"
          description="Executes a real checkout with an in-stock catalog product. On failure, inspect the durable incident record produced by analyzing the resulting trace."
        />

        <div className="mt-4">
          {productError ? (
            <Notice tone="error">Catalog unavailable: {productError.detail}</Notice>
          ) : product ? (
            <div className="flex flex-col gap-2 rounded-2xl border border-white/[0.065] bg-black/20 p-3.5 text-[11px] sm:flex-row sm:items-center sm:justify-between">
              <span className="break-all font-mono font-semibold text-white/70">{product.sku}</span>
              <span className="min-w-0 break-words text-white/50">{product.name}</span>
              <span className="shrink-0 font-semibold text-white/78">${(Number(product.price_cents) / 100).toFixed(2)}</span>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/[0.065] bg-black/20 p-3.5 text-[11px] text-white/46">
              Loading catalog...
            </div>
          )}
        </div>

        <Button
          onClick={triggerTestCheckout}
          disabled={checkoutLoading || !product}
          loading={checkoutLoading}
          variant="primary"
          className="mt-4"
        >
          <ShoppingCart className="h-4 w-4" />
          {checkoutLoading ? 'Executing checkout saga' : 'Run test checkout now'}
        </Button>

        {checkoutResult && (
          <div className={cn(
            'mt-4 rounded-2xl border p-4',
            checkoutResult.success
              ? 'border-emerald-400/20 bg-emerald-400/[0.055]'
              : 'border-rose-400/20 bg-rose-400/[0.055]'
          )}>
            {checkoutResult.success ? (
              <div className="space-y-1 text-[11px] text-emerald-200">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <CheckCircle2 className="h-4 w-4" />
                  Checkout saga succeeded
                </div>
                <div className="flex flex-wrap items-center gap-1.5 break-all font-mono text-white/70">
                  <span>Order: {checkoutResult.data.orderId}</span>
                  <CopyButton compact value={checkoutResult.data.orderId} label="Copy order ID" />
                  <span>| Status: {checkoutResult.data.status}</span>
                </div>
                <div className="flex items-center gap-1.5 break-all font-mono text-white/50">
                  <span>Payment: {checkoutResult.data.paymentId}</span>
                  <CopyButton compact value={checkoutResult.data.paymentId} label="Copy payment ID" />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 text-sm font-bold text-rose-300">
                    <AlertTriangle className="h-4 w-4" />
                    Checkout failed
                    {checkoutResult.error.status ? ` (HTTP ${checkoutResult.error.status})` : ''}
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => navigate('/incidents')}>
                    View incidents <ArrowRight className="h-3 w-3" />
                  </Button>
                </div>
                <div className="break-all rounded-xl border border-white/[0.06] bg-black/25 p-3 font-mono text-[10px] leading-relaxed text-white/62">
                  <span className="font-bold text-rose-300">{checkoutResult.error.code || 'ERROR'}</span>
                  {' — '}
                  {checkoutResult.error.detail}
                </div>
              </div>
            )}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
