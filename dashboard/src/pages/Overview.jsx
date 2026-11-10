import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { 
  Activity, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  ShoppingCart, 
  ArrowRight,
  TrendingUp,
  Cpu
} from 'lucide-react';

export default function Overview() {
  const navigate = useNavigate();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState(null);
  const [servicesHealth, setServicesHealth] = useState([
    { name: 'user-service', port: 8081, status: 'UP', latency: '4ms' },
    { name: 'product-service', port: 8082, status: 'UP', latency: '6ms' },
    { name: 'order-service', port: 8083, status: 'UP', latency: '12ms' },
    { name: 'payment-service', port: 8084, status: 'UP', latency: '18ms' },
    { name: 'inventory-service', port: 5050, status: 'UP', latency: '8ms' },
    { name: 'analysis-engine', port: 5000, status: 'UP', latency: '5ms' },
  ]);

  const handleQuickCheckout = async () => {
    setCheckoutLoading(true);
    setCheckoutResult(null);
    try {
      const resp = await axios.post('/api/orders/checkout', {
        userId: 1,
        items: [
          { productId: 'PROD-001', sku: 'SKU-LAPTOP-001', quantity: 1, priceCents: 129999 }
        ],
        idempotencyKey: `idem-ui-${Date.now()}`
      });
      setCheckoutResult({ success: true, data: resp.data });
    } catch (err) {
      const errorData = err.response?.data || { detail: err.message };
      setCheckoutResult({ success: false, error: errorData });
    } finally {
      setCheckoutLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-100 tracking-tight">System Overview</h2>
        <p className="text-sm text-slate-400 mt-1">Real-time health, distributed topology, and automated causal root cause diagnostics.</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <div className="bg-slate-800/50 border border-slate-700/60 p-5 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Services Online</span>
            <span className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg">
              <CheckCircle2 className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-100">6 / 6</span>
            <span className="text-xs text-emerald-400 font-medium">100% Active</span>
          </div>
        </div>

        <div className="bg-slate-800/50 border border-slate-700/60 p-5 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Incidents</span>
            <span className="p-2 bg-rose-500/10 text-rose-400 rounded-lg">
              <AlertTriangle className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-100">1</span>
            <span className="text-xs text-rose-400 font-medium">Payment Delay</span>
          </div>
        </div>

        <div className="bg-slate-800/50 border border-slate-700/60 p-5 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Saga Success Rate</span>
            <span className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg">
              <TrendingUp className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-100">98.4%</span>
            <span className="text-xs text-emerald-400 font-medium">+1.2%</span>
          </div>
        </div>

        <div className="bg-slate-800/50 border border-slate-700/60 p-5 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Timing Engine</span>
            <span className="p-2 bg-amber-500/10 text-amber-400 rounded-lg">
              <Cpu className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-xl font-bold text-slate-100">Sweep-Line</span>
            <span className="text-xs text-indigo-400 font-mono">O(N log N)</span>
          </div>
        </div>
      </div>

      {/* Services Grid & Quick Checkout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-slate-800/50 border border-slate-700/60 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-200">Microservices Health Matrix</h3>
            <button
              onClick={() => navigate('/services')}
              className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium"
            >
              View Details <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-700/50">
            {servicesHealth.map((svc) => (
              <div key={svc.name} className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400"></div>
                  <div>
                    <span className="text-sm font-medium text-slate-200">{svc.name}</span>
                    <span className="text-xs text-slate-500 block font-mono">Port :{svc.port}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-slate-400 font-mono">{svc.latency}</span>
                  <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    {svc.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Live Checkout Simulator */}
        <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <h3 className="font-semibold text-slate-200 flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-indigo-400" />
              Live Checkout Test
            </h3>
            <p className="text-xs text-slate-400 mt-2">
              Triggers end-to-end distributed Saga: Order $\to$ Inventory Reserve $\to$ Payment Charge $\to$ Inventory Commit.
            </p>

            <div className="mt-4 p-3 bg-slate-900/60 rounded-lg border border-slate-700/50 space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-300">
                <span>SKU-LAPTOP-001</span>
                <span>$1,299.99</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Quantity</span>
                <span>1</span>
              </div>
            </div>

            {checkoutResult && (
              <div className={`mt-4 p-3 rounded-lg border text-xs ${
                checkoutResult.success 
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}>
                {checkoutResult.success ? (
                  <div>
                    <span className="font-semibold block">Order Confirmed!</span>
                    <span className="font-mono text-[11px] block mt-1">ID: {checkoutResult.data.orderId}</span>
                    <span className="font-mono text-[11px] block">Payment: {checkoutResult.data.paymentId}</span>
                  </div>
                ) : (
                  <div>
                    <span className="font-semibold block">Checkout Failed (Compensated)</span>
                    <span className="block mt-1">{checkoutResult.error.detail || 'Service Error'}</span>
                    <button
                      onClick={() => navigate('/incidents')}
                      className="mt-2 text-indigo-400 underline font-medium block"
                    >
                      View RCA Incident Analysis &rarr;
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            onClick={handleQuickCheckout}
            disabled={checkoutLoading}
            className="w-full mt-6 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-medium text-xs shadow-md transition"
          >
            {checkoutLoading ? 'Executing Distributed Saga...' : 'Trigger Checkout Saga'}
          </button>
        </div>
      </div>
    </div>
  );
}
