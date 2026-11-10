import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { 
  Zap, 
  RotateCcw, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  ShoppingCart, 
  ArrowRight,
  Server,
  Database,
  CreditCard,
  Package
} from 'lucide-react';

const faultScenarios = [
  {
    id: 'pay-latency',
    target: 'payment-service',
    title: 'Payment Gateway Latency (3s)',
    description: 'Simulates a 3,000ms delay on external payment gateway. Tests timeout handling and sweep-line interval union self-time anomaly detection.',
    mode: 'LATENCY',
    latencyMs: 3000,
    apiEndpoint: '/api/payments/fault',
    icon: CreditCard,
    severity: 'MEDIUM'
  },
  {
    id: 'pay-timeout',
    target: 'payment-service',
    title: 'Payment Gateway Timeout (504)',
    description: 'Forces HTTP 504 Gateway Timeout on payment charges. Tests order checkout saga compensation and automatic RCA culprit ranking.',
    mode: 'GATEWAY_TIMEOUT',
    apiEndpoint: '/api/payments/fault',
    icon: CreditCard,
    severity: 'HIGH'
  },
  {
    id: 'pay-declined',
    target: 'payment-service',
    title: 'Card Processor Declined (422)',
    description: 'Simulates an unprocessable entity payment decline. Tests order rollback and client-facing RFC 9457 error propagation.',
    mode: 'DECLINED',
    apiEndpoint: '/api/payments/fault',
    icon: CreditCard,
    severity: 'LOW'
  },
  {
    id: 'pay-down',
    target: 'payment-service',
    title: 'Payment Service Outage (503)',
    description: 'Simulates catastrophic payment simulator downtime returning HTTP 503 Service Unavailable.',
    mode: 'GATEWAY_DOWN',
    apiEndpoint: '/api/payments/fault',
    icon: CreditCard,
    severity: 'CRITICAL'
  },
  {
    id: 'inv-out-of-stock',
    target: 'inventory-service',
    title: 'Inventory Out of Stock (409)',
    description: 'Simulates zero stock for SKU reservation. Tests immediate checkout rejection and zero phantom inventory leakage.',
    mode: 'FORCE_OUT_OF_STOCK',
    apiEndpoint: '/api/inventory/fault',
    icon: Package,
    severity: 'MEDIUM'
  },
  {
    id: 'inv-busy',
    target: 'inventory-service',
    title: 'SQLite Busy Lock Delay',
    description: 'Simulates concurrent write contention on SQLite inventory database with simulated lock wait delay.',
    mode: 'BUSY_DELAY',
    apiEndpoint: '/api/inventory/fault',
    icon: Database,
    severity: 'HIGH'
  }
];

export default function FaultInjection() {
  const navigate = useNavigate();
  const [activeFaults, setActiveFaults] = useState({});
  const [statusMessage, setStatusMessage] = useState(null);
  const [loadingFaultId, setLoadingFaultId] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState(null);

  const injectFault = async (scenario) => {
    setLoadingFaultId(scenario.id);
    setStatusMessage(null);
    try {
      const payload = scenario.latencyMs
        ? { mode: scenario.mode, latencyMs: scenario.latencyMs }
        : { mode: scenario.mode };
      await axios.post(scenario.apiEndpoint, payload);
      setActiveFaults((prev) => ({ ...prev, [scenario.target]: scenario.title }));
      setStatusMessage({ type: 'success', text: `Injected fault: ${scenario.title}` });
    } catch (err) {
      // In offline/mock mode, update state locally
      setActiveFaults((prev) => ({ ...prev, [scenario.target]: scenario.title }));
      setStatusMessage({ 
        type: 'info', 
        text: `Active in local simulation: ${scenario.title}` 
      });
    } finally {
      setLoadingFaultId(null);
    }
  };

  const resetAllFaults = async () => {
    setStatusMessage(null);
    try {
      await axios.post('/api/payments/fault', { mode: 'NORMAL' });
      await axios.post('/api/inventory/fault', { mode: 'NORMAL' });
    } catch {
      // Ignore
    }
    setActiveFaults({});
    setStatusMessage({ type: 'success', text: 'All injected faults reset to NORMAL mode.' });
  };

  const triggerTestCheckout = async () => {
    setCheckoutLoading(true);
    setCheckoutResult(null);
    try {
      const resp = await axios.post('/api/orders/checkout', {
        userId: 1,
        items: [
          { productId: 'PROD-001', sku: 'SKU-LAPTOP-001', quantity: 1, priceCents: 129999 }
        ],
        idempotencyKey: `idem-fault-test-${Date.now()}`
      });
      setCheckoutResult({ success: true, data: resp.data });
    } catch (err) {
      const errorData = err.response?.data || { 
        title: 'Checkout Failed', 
        status: err.response?.status || 500,
        detail: err.message 
      };
      setCheckoutResult({ success: false, error: errorData });
    } finally {
      setCheckoutLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            <Zap className="w-6 h-6 text-amber-400" />
            Chaos & Fault Injection Console
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Simulate realistic distributed failure modes across the microservice mesh to test automated RCA and resilience.
          </p>
        </div>

        <button
          onClick={resetAllFaults}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-2 transition shadow-sm w-fit"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset All Faults
        </button>
      </div>

      {/* Status Notice */}
      {statusMessage && (
        <div
          className={`p-4 rounded-xl border flex items-center gap-3 text-sm ${
            statusMessage.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
              : 'bg-indigo-950/40 border-indigo-800 text-indigo-300'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Active Fault Status Monitor */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Active Injected Faults
        </h3>
        {Object.keys(activeFaults).length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-950/30 border border-emerald-900/50 px-3 py-2 rounded-lg">
            <CheckCircle2 className="w-4 h-4" />
            All microservices running in NORMAL baseline operation.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {Object.entries(activeFaults).map(([target, faultName]) => (
              <span
                key={target}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 text-xs font-medium"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                <span className="font-mono font-semibold">{target}:</span>
                <span>{faultName}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Fault Injection Cards Grid */}
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
                disabled={isLoading}
                className="w-full py-2 px-3 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5 text-rose-400" />
                {isLoading ? 'Injecting...' : 'Inject This Fault'}
              </button>
            </div>
          );
        })}
      </div>

      {/* Test Execution & Trigger */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h3 className="text-lg font-bold text-slate-100 mb-2 flex items-center gap-2">
          <ShoppingCart className="w-5 h-5 text-indigo-400" />
          Trigger Checkout Saga Under Current Fault State
        </h3>
        <p className="text-xs text-slate-400 mb-4 max-w-2xl">
          Execute an end-to-end checkout (`POST /api/orders/checkout`) with an active fault injected. Observe whether the saga orchestrator completes or compensates, and view the causal root cause.
        </p>

        <div className="flex items-center gap-4">
          <button
            onClick={triggerTestCheckout}
            disabled={checkoutLoading}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-2 transition shadow-md"
          >
            <ShoppingCart className="w-4 h-4" />
            {checkoutLoading ? 'Executing Checkout Saga...' : 'Run Test Checkout Now'}
          </button>
        </div>

        {/* Checkout Result Preview */}
        {checkoutResult && (
          <div className="mt-5 p-4 rounded-xl border bg-slate-950">
            {checkoutResult.success ? (
              <div className="text-emerald-400 text-xs font-medium space-y-1">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <CheckCircle2 className="w-4 h-4" />
                  Checkout Saga Succeeded!
                </div>
                <div className="font-mono text-slate-300">
                  Order ID: {checkoutResult.data.orderId || 'ORD-TEST'} | Status: {checkoutResult.data.status || 'COMPLETED'}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
                    <AlertTriangle className="w-4 h-4" />
                    Checkout Failed (Fault Triggered)
                  </div>
                  <button
                    onClick={() => navigate('/rca')}
                    className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg flex items-center gap-1 transition"
                  >
                    View Root Cause Analysis
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="text-xs font-mono text-slate-300 bg-slate-900 p-3 rounded-lg border border-slate-800">
                  <span className="text-rose-400 font-bold">Status: {checkoutResult.error.status || 500}</span> — {checkoutResult.error.title || 'Error'}: {checkoutResult.error.detail || JSON.stringify(checkoutResult.error)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
