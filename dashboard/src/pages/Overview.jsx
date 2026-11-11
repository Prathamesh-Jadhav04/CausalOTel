import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  CheckCircle2, 
  AlertTriangle, 
  ShoppingCart, 
  ArrowRight,
  RefreshCw,
  Database,
  Activity
} from 'lucide-react';
import api from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import {
  describeApiError,
  normalizeIncidentList,
  normalizeServiceHealth
} from '../lib/contracts.js';

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
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState(null);

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
  };

  useEffect(() => {
    load();
  }, []);

  const activeIncidents = incidents ? incidents.filter(incident => incident.status === 'ACTIVE') : null;
  const latestIncident = incidents?.[0] || null;

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

  const serviceRows = health?.services || [];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight">System Overview</h2>
          <p className="text-sm text-slate-400 mt-1">
            Live probes, recorded incidents, and real checkout execution. No mock operational data.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
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
            <span className="text-3xl font-extrabold text-slate-100">
              {health ? `${health.upCount} / ${health.totalCount}` : '—'}
            </span>
            <span className={`text-xs font-medium ${healthError ? 'text-rose-400' : 'text-emerald-400'}`}>
              {healthError ? 'Probe unavailable' : 'Live health probes'}
            </span>
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
            <span className="text-3xl font-extrabold text-slate-100">
              {activeIncidents ? activeIncidents.length : '—'}
            </span>
            <span className={`text-xs font-medium ${incidentsError ? 'text-rose-400' : 'text-slate-400'}`}>
              {incidentsError
                ? 'Store unavailable'
                : latestIncident
                  ? latestIncident.rootCauseType
                  : 'None recorded'}
            </span>
          </div>
        </div>

        <div className="bg-slate-800/50 border border-slate-700/60 p-5 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Recorded Incidents</span>
            <span className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg">
              <Database className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-100">
              {incidents ? incidents.length : '—'}
            </span>
            <span className="text-xs text-slate-400 font-medium">Durable disk spool</span>
          </div>
        </div>

        <div className="bg-slate-800/50 border border-slate-700/60 p-5 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Analysis Engine</span>
            <span className="p-2 bg-amber-500/10 text-amber-400 rounded-lg">
              <Activity className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className={`text-xl font-bold ${analysisError ? 'text-rose-400' : 'text-slate-100'}`}>
              {analysisError ? 'UNAVAILABLE' : analysis?.status || '—'}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {analysis ? `${analysis.pendingIncidentsCount} pending` : analysisError?.detail || ''}
            </span>
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

          {healthError ? (
            <div className="p-4 bg-rose-950/30 border border-rose-800 rounded-lg text-xs text-rose-300">
              Health probe failed: {healthError.detail}
            </div>
          ) : serviceRows.length === 0 ? (
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-400">
              {loading ? 'Probing services...' : 'No services reported by the probe.'}
            </div>
          ) : (
            <div className="divide-y divide-slate-700/50">
              {serviceRows.map((svc) => (
                <div key={svc.name} className="py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${
                      svc.status === 'UP' ? 'bg-emerald-400'
                        : svc.status === 'DOWN' ? 'bg-amber-400'
                          : 'bg-rose-400'
                    }`}></div>
                    <div>
                      <span className="text-sm font-medium text-slate-200">{svc.name}</span>
                      <span className="text-xs text-slate-500 block font-mono">Port :{svc.port}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-slate-400 font-mono">
                      {svc.latencyMs === null ? '—' : `${svc.latencyMs}ms`}
                    </span>
                    <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full border ${
                      svc.status === 'UP'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : svc.status === 'DOWN'
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                    }`}>
                      {svc.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Live Checkout */}
        <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <h3 className="font-semibold text-slate-200 flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-indigo-400" />
              Live Checkout Test
            </h3>
            <p className="text-xs text-slate-400 mt-2">
              Executes the real saga: order → inventory reserve → payment charge → inventory commit.
            </p>

            {productError ? (
              <div className="mt-4 p-3 bg-rose-950/30 border border-rose-800 rounded-lg text-xs text-rose-300">
                Catalog unavailable: {productError.detail}
              </div>
            ) : product ? (
              <div className="mt-4 p-3 bg-slate-900/60 rounded-lg border border-slate-700/50 space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-300">
                  <span className="font-mono">{product.sku}</span>
                  <span>${(Number(product.price_cents) / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>{product.name}</span>
                  <span>Qty 1</span>
                </div>
              </div>
            ) : (
              <div className="mt-4 p-3 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-400">
                {loading ? 'Loading catalog...' : 'No product available.'}
              </div>
            )}

            {checkoutResult && (
              <div className={`mt-4 p-3 rounded-lg border text-xs ${
                checkoutResult.success 
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}>
                {checkoutResult.success ? (
                  <div>
                    <span className="font-semibold block">Order {checkoutResult.data.status}</span>
                    <span className="font-mono text-[11px] block mt-1">ID: {checkoutResult.data.orderId}</span>
                    <span className="font-mono text-[11px] block">Payment: {checkoutResult.data.paymentId}</span>
                  </div>
                ) : (
                  <div>
                    <span className="font-semibold block">
                      Checkout failed {checkoutResult.error.status ? `(HTTP ${checkoutResult.error.status})` : ''}
                    </span>
                    <span className="block mt-1">{checkoutResult.error.detail}</span>
                    <button
                      onClick={() => navigate('/incidents')}
                      className="mt-2 text-indigo-400 underline font-medium block"
                    >
                      View recorded incidents &rarr;
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            onClick={handleQuickCheckout}
            disabled={checkoutLoading || !product}
            className="w-full mt-6 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-medium text-xs shadow-md transition"
          >
            {checkoutLoading ? 'Executing checkout saga...' : 'Trigger Checkout Saga'}
          </button>
        </div>
      </div>
    </div>
  );
}
