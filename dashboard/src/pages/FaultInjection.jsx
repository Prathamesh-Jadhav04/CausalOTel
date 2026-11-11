import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Zap,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  ShoppingCart,
  ArrowRight,
  CreditCard,
  Package,
  Database,
  RefreshCw,
  ShieldAlert
} from 'lucide-react';
import api from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import {
  describeApiError,
  faultResetRequests,
  inventoryFaultPayload,
  paymentFaultPayload
} from '../lib/contracts.js';

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
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            <Zap className="w-6 h-6 text-amber-400" />
            Fault Injection Console
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Fault injection mutates payment and inventory behavior.
          </p>
        </div>
        <div className="bg-slate-900 border border-amber-800/60 rounded-xl p-8 text-center">
          <ShieldAlert className="w-9 h-9 text-amber-400 mx-auto mb-3" />
          <p className="text-base font-semibold text-slate-200">Administrator role required</p>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            Your session role is <span className="font-mono text-slate-300">{session?.role}</span>.
            Both payment and inventory fault endpoints require <span className="font-mono text-amber-300">ROLE_ADMIN</span>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            <Zap className="w-6 h-6 text-amber-400" />
            Chaos & Fault Injection Console
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Bounded, audited, admin-only fault modes. State is read back from each service after every change.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={refreshFaultState}
            disabled={loadingState}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-2 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingState ? 'animate-spin' : ''}`} />
            Refresh State
          </button>
          <button
            onClick={resetAllFaults}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-2 transition shadow-sm"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset All Faults
          </button>
        </div>
      </div>

      {statusMessage && (
        <div
          className={`p-4 rounded-xl border flex items-center gap-3 text-sm ${
            statusMessage.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
              : 'bg-rose-950/40 border-rose-800 text-rose-300'
          }`}
        >
          {statusMessage.type === 'success'
            ? <CheckCircle2 className="w-4 h-4 shrink-0" />
            : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {faultError && (
        <div className="p-4 bg-rose-950/30 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Fault state unavailable ({faultError.code || 'ERROR'})</div>
            <div className="mt-1">{faultError.detail}</div>
            <div className="mt-1 text-rose-400/80">
              Fault injection may be disabled by configuration on one or both services.
            </div>
          </div>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Active Injected Faults (read from services)
        </h3>
        {loadingState ? (
          <div className="text-xs text-slate-400 animate-pulse">Reading fault state...</div>
        ) : faultError ? (
          <div className="text-xs text-slate-400">Unavailable until the fault endpoints respond.</div>
        ) : activeFaults.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-950/30 border border-emerald-900/50 px-3 py-2 rounded-lg">
            <CheckCircle2 className="w-4 h-4" />
            Payment and inventory services report NORMAL operation.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {activeFaults.map((fault) => (
              <span
                key={fault.target}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 text-xs font-medium"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                <span className="font-mono font-semibold">{fault.target}:</span>
                <span>{fault.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {faultScenarios.map((scenario) => {
          const Icon = scenario.icon;
          const isLoading = loadingFaultId === scenario.id;
          return (
            <div
              key={scenario.id}
              className="bg-slate-900 border border-slate-800 hover:border-slate-700 transition rounded-xl p-5 flex flex-col justify-between space-y-4"
            >
              <div>
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-indigo-400">
                    <Icon className="w-5 h-5" />
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      scenario.severity === 'CRITICAL'
                        ? 'bg-rose-950/80 border border-rose-800 text-rose-300'
                        : scenario.severity === 'HIGH'
                          ? 'bg-amber-950/80 border border-amber-800 text-amber-300'
                          : 'bg-indigo-950/80 border border-indigo-800 text-indigo-300'
                    }`}
                  >
                    {scenario.severity}
                  </span>
                </div>

                <h4 className="font-semibold text-slate-100 text-base">{scenario.title}</h4>
                <div className="text-xs text-indigo-400 font-mono mt-0.5">Target: {scenario.target}</div>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">{scenario.description}</p>
              </div>

              <button
                onClick={() => injectFault(scenario)}
                disabled={isLoading || Boolean(faultError)}
                className="w-full py-2 px-3 bg-rose-950/40 hover:bg-rose-900/60 disabled:opacity-50 text-rose-300 border border-rose-800/60 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5 text-rose-400" />
                {isLoading ? 'Injecting...' : 'Inject This Fault'}
              </button>
            </div>
          );
        })}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h3 className="text-lg font-bold text-slate-100 mb-2 flex items-center gap-2">
          <ShoppingCart className="w-5 h-5 text-indigo-400" />
          Trigger Checkout Saga Under Current Fault State
        </h3>
        <p className="text-xs text-slate-400 mb-4 max-w-2xl">
          Executes a real checkout with an in-stock catalog product. On failure, inspect the durable incident record
          produced by analyzing the resulting trace.
        </p>

        {productError ? (
          <div className="mb-4 p-3 bg-rose-950/30 border border-rose-800 rounded-lg text-xs text-rose-300">
            Catalog unavailable: {productError.detail}
          </div>
        ) : product ? (
          <div className="mb-4 p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs flex items-center justify-between">
            <span className="font-mono text-slate-300">{product.sku}</span>
            <span className="text-slate-400">{product.name}</span>
            <span className="text-slate-300">${(Number(product.price_cents) / 100).toFixed(2)}</span>
          </div>
        ) : (
          <div className="mb-4 p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs text-slate-400">
            Loading catalog...
          </div>
        )}

        <button
          onClick={triggerTestCheckout}
          disabled={checkoutLoading || !product}
          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-2 transition shadow-md"
        >
          <ShoppingCart className="w-4 h-4" />
          {checkoutLoading ? 'Executing Checkout Saga...' : 'Run Test Checkout Now'}
        </button>

        {checkoutResult && (
          <div className="mt-5 p-4 rounded-xl border bg-slate-950">
            {checkoutResult.success ? (
              <div className="text-emerald-400 text-xs font-medium space-y-1">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <CheckCircle2 className="w-4 h-4" />
                  Checkout saga succeeded
                </div>
                <div className="font-mono text-slate-300">
                  Order: {checkoutResult.data.orderId} | Status: {checkoutResult.data.status}
                </div>
                <div className="font-mono text-slate-400">Payment: {checkoutResult.data.paymentId}</div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
                    <AlertTriangle className="w-4 h-4" />
                    Checkout failed
                    {checkoutResult.error.status ? ` (HTTP ${checkoutResult.error.status})` : ''}
                  </div>
                  <button
                    onClick={() => navigate('/incidents')}
                    className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg flex items-center gap-1 transition"
                  >
                    View Incidents
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="text-xs font-mono text-slate-300 bg-slate-900 p-3 rounded-lg border border-slate-800">
                  <span className="text-rose-400 font-bold">
                    {checkoutResult.error.code || 'ERROR'}
                  </span>
                  {' — '}
                  {checkoutResult.error.detail}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
