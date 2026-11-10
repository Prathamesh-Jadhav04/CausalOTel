import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  BarChart3, 
  Activity, 
  Clock, 
  Server, 
  AlertTriangle, 
  CheckCircle2, 
  TrendingUp, 
  Zap,
  RefreshCw
} from 'lucide-react';

const mockMetrics = [
  {
    service: 'user-service',
    port: 8081,
    rps: 42,
    p50: '3ms',
    p95: '7ms',
    p99: '14ms',
    errorRate: 0.0,
    dbConnections: 3,
    status: 'HEALTHY'
  },
  {
    service: 'product-service',
    port: 8082,
    rps: 88,
    p50: '5ms',
    p95: '12ms',
    p99: '21ms',
    errorRate: 0.0,
    dbConnections: 4,
    status: 'HEALTHY'
  },
  {
    service: 'order-service',
    port: 8083,
    rps: 34,
    p50: '14ms',
    p95: '45ms',
    p99: '110ms',
    errorRate: 1.2,
    dbConnections: 5,
    status: 'HEALTHY'
  },
  {
    service: 'payment-service',
    port: 8084,
    rps: 28,
    p50: '18ms',
    p95: '120ms',
    p99: '3250ms',
    errorRate: 4.8,
    dbConnections: 3,
    status: 'DEGRADED'
  },
  {
    service: 'inventory-service',
    port: 5050,
    rps: 56,
    p50: '6ms',
    p95: '15ms',
    p99: '28ms',
    errorRate: 0.5,
    dbConnections: 4,
    status: 'HEALTHY'
  },
  {
    service: 'analysis-engine',
    port: 5000,
    rps: 16,
    p50: '8ms',
    p95: '22ms',
    p99: '42ms',
    errorRate: 0.0,
    dbConnections: 1,
    status: 'HEALTHY'
  }
];

export default function Metrics() {
  const [metrics, setMetrics] = useState(mockMetrics);
  const [selectedService, setSelectedService] = useState('ALL');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchMetrics();
  }, []);

  const fetchMetrics = async () => {
    setLoading(true);
    try {
      const resp = await axios.get('/api/analysis/metrics');
      if (resp.data && Array.isArray(resp.data)) {
        setMetrics(resp.data);
      }
    } catch {
      // Use fallback
    } finally {
      setLoading(false);
    }
  };

  const displayedMetrics = selectedService === 'ALL'
    ? metrics
    : metrics.filter((m) => m.service === selectedService);

  const totalRps = metrics.reduce((acc, m) => acc + m.rps, 0);
  const avgErrorRate = (metrics.reduce((acc, m) => acc + m.errorRate, 0) / metrics.length).toFixed(2);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight">System Metrics</h2>
          <p className="text-sm text-slate-400 mt-1">
            Real-time throughput, latency percentiles, error rates, and connection pool saturation.
          </p>
        </div>
        <button
          onClick={fetchMetrics}
          disabled={loading}
          className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Refreshing...' : 'Refresh Metrics'}
        </button>
      </div>

      {/* High-Level Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Throughput</div>
          <div className="text-2xl font-bold text-slate-100 mt-2 flex items-baseline gap-1.5">
            <span>{totalRps}</span>
            <span className="text-xs text-slate-400 font-normal">req/s</span>
          </div>
          <div className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" />
            +8.2% from last hour
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Average Error Rate</div>
          <div className="text-2xl font-bold text-rose-400 mt-2">
            {avgErrorRate}%
          </div>
          <div className="text-xs text-slate-400 mt-2">
            Payment gateway anomalies detected
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">P99 Mesh Latency</div>
          <div className="text-2xl font-bold text-amber-400 mt-2">
            3,250 ms
          </div>
          <div className="text-xs text-amber-400/80 mt-2 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            Breaching 500ms SLA target
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active DB Pools</div>
          <div className="text-2xl font-bold text-emerald-400 mt-2">
            21 / 30
          </div>
          <div className="text-xs text-slate-400 mt-2">
            SQLite WAL mode active across 5 services
          </div>
        </div>
      </div>

      {/* Filter by service */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <span className="text-xs text-slate-400 font-medium whitespace-nowrap">Filter Service:</span>
        <button
          onClick={() => setSelectedService('ALL')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            selectedService === 'ALL'
              ? 'bg-indigo-600 text-white shadow'
              : 'bg-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          All Services
        </button>
        {metrics.map((m) => (
          <button
            key={m.service}
            onClick={() => setSelectedService(m.service)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium font-mono whitespace-nowrap transition ${
              selectedService === m.service
                ? 'bg-indigo-600 text-white shadow'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {m.service}
          </button>
        ))}
      </div>

      {/* Service Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {displayedMetrics.map((svc) => (
          <div
            key={svc.service}
            className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition shadow-sm space-y-4"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-mono font-semibold text-slate-100 text-base">{svc.service}</h3>
                <span className="text-xs text-indigo-400 font-mono">Port :{svc.port}</span>
              </div>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  svc.status === 'HEALTHY'
                    ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-300'
                    : 'bg-rose-950/80 border border-rose-800 text-rose-300 animate-pulse'
                }`}
              >
                {svc.status}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 py-3 border-y border-slate-800 text-xs">
              <div>
                <div className="text-slate-500">RPS:</div>
                <div className="text-slate-200 font-semibold font-mono text-sm mt-0.5">{svc.rps} req/s</div>
              </div>
              <div>
                <div className="text-slate-500">Error Rate:</div>
                <div className={`font-semibold font-mono text-sm mt-0.5 ${svc.errorRate > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {svc.errorRate}%
                </div>
              </div>
              <div>
                <div className="text-slate-500">P50 Latency:</div>
                <div className="text-slate-300 font-mono mt-0.5">{svc.p50}</div>
              </div>
              <div>
                <div className="text-slate-500">P99 Latency:</div>
                <div className={`font-mono font-semibold mt-0.5 ${parseInt(svc.p99) > 500 ? 'text-amber-400' : 'text-slate-300'}`}>
                  {svc.p99}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>SQLite Active Conns:</span>
              <span className="font-mono text-slate-200 font-semibold">{svc.dbConnections}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
