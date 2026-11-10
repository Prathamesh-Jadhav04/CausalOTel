import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { 
  AlertTriangle, 
  Search, 
  ArrowRight, 
  ShieldAlert, 
  CheckCircle2, 
  Clock, 
  Server,
  Activity,
  Filter
} from 'lucide-react';

const fallbackIncidents = [
  {
    incidentId: 'INC-2026-001',
    traceId: 'trace-chk-771a4f09',
    culpritService: 'payment-service',
    rootCauseType: 'GATEWAY_TIMEOUT',
    severity: 'CRITICAL',
    confidenceScore: 0.96,
    summary: 'Payment service simulated gateway timeout (3000ms threshold breached).',
    status: 'ACTIVE',
    createdAt: new Date(Date.now() - 1000 * 60 * 3).toISOString()
  },
  {
    incidentId: 'INC-2026-002',
    traceId: 'trace-chk-112e5f33',
    culpritService: 'inventory-service',
    rootCauseType: 'INSUFFICIENT_STOCK',
    severity: 'HIGH',
    confidenceScore: 0.91,
    summary: 'Stock reservation failed with HTTP 409 Conflict for SKU-OUT-OF-STOCK-004.',
    status: 'RESOLVED',
    createdAt: new Date(Date.now() - 1000 * 60 * 25).toISOString()
  },
  {
    incidentId: 'INC-2026-003',
    traceId: 'trace-chk-334d9a11',
    culpritService: 'payment-service',
    rootCauseType: 'PAYMENT_DECLINED',
    severity: 'MEDIUM',
    confidenceScore: 0.88,
    summary: 'Card processor declined charge during checkout saga.',
    status: 'RESOLVED',
    createdAt: new Date(Date.now() - 1000 * 60 * 65).toISOString()
  }
];

export default function Incidents() {
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState(fallbackIncidents);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchIncidents();
  }, []);

  const fetchIncidents = async () => {
    setLoading(true);
    try {
      const resp = await axios.get('/api/analysis/incidents');
      if (resp.data && Array.isArray(resp.data) && resp.data.length > 0) {
        setIncidents(resp.data);
      }
    } catch {
      // Use fallback if analysis engine has not generated incidents yet
    } finally {
      setLoading(false);
    }
  };

  const filteredIncidents = incidents.filter((inc) => {
    const matchesSearch = 
      inc.incidentId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inc.culpritService.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (inc.rootCauseType && inc.rootCauseType.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus = statusFilter === 'ALL' || inc.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight">Causal Incidents</h2>
          <p className="text-sm text-slate-400 mt-1">
            Automated anomaly detection and root cause incident register powered by CausalOTel.
          </p>
        </div>
        <button
          onClick={fetchIncidents}
          disabled={loading}
          className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition shadow-sm"
        >
          {loading ? 'Refreshing...' : 'Refresh Incidents'}
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-slate-900 border border-slate-800 p-4 rounded-xl">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search incident ID, culprit service, or error..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-xs text-slate-400 font-medium">Status:</span>
          {['ALL', 'ACTIVE', 'RESOLVED'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                statusFilter === status
                  ? 'bg-indigo-600 text-white shadow'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Incidents List */}
      <div className="space-y-3">
        {filteredIncidents.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
            <p className="text-base font-medium text-slate-300">No matching incidents found</p>
            <p className="text-xs text-slate-500 mt-1">The system is operating smoothly with 0 anomalous events.</p>
          </div>
        ) : (
          filteredIncidents.map((inc) => (
            <div
              key={inc.incidentId}
              className="bg-slate-900 border border-slate-800 hover:border-slate-700 transition rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm"
            >
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-mono text-sm font-semibold text-slate-200">{inc.incidentId}</span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      inc.severity === 'CRITICAL'
                        ? 'bg-red-950/60 border border-red-800 text-red-300'
                        : inc.severity === 'HIGH'
                        ? 'bg-amber-950/60 border border-amber-800 text-amber-300'
                        : 'bg-indigo-950/60 border border-indigo-800 text-indigo-300'
                    }`}
                  >
                    {inc.severity}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      inc.status === 'ACTIVE'
                        ? 'bg-rose-950/80 border border-rose-800 text-rose-300 animate-pulse'
                        : 'bg-emerald-950/60 border border-emerald-800 text-emerald-300'
                    }`}
                  >
                    {inc.status}
                  </span>
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {new Date(inc.createdAt).toLocaleTimeString()}
                  </span>
                </div>

                <p className="text-sm text-slate-300 font-medium">{inc.summary}</p>

                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5 text-indigo-400" />
                    Culprit: <span className="font-mono font-semibold text-rose-400">{inc.culpritService}</span>
                  </span>
                  <span>•</span>
                  <span>
                    Confidence: <span className="font-semibold text-emerald-400">{(inc.confidenceScore * 100).toFixed(0)}%</span>
                  </span>
                  {inc.traceId && (
                    <>
                      <span>•</span>
                      <span className="font-mono text-slate-400">Trace: {inc.traceId}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate(`/rca/${inc.incidentId}`)}
                  className="px-3.5 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  Inspect RCA
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
