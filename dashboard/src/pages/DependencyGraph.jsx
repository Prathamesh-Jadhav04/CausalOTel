import React, { useEffect, useState } from 'react';
import { GitFork, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import api from '../lib/api.js';
import { describeApiError } from '../lib/contracts.js';

const coordinates = {
  dashboard: { x: 100, y: 150 },
  'user-service': { x: 300, y: 60 },
  'product-service': { x: 300, y: 150 },
  'order-service': { x: 300, y: 260 },
  'inventory-service': { x: 550, y: 200 },
  'payment-service': { x: 550, y: 320 },
  'analysis-engine': { x: 420, y: 400 }
};

export default function DependencyGraph() {
  const [graphData, setGraphData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/analysis/graph');
      setGraphData(response.data);
      setError(null);
    } catch (err) {
      setGraphData(null);
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight">Dependency Graph Topology</h2>
          <p className="text-sm text-slate-400 mt-1">
            Directed microservice dependency graph solved with Tarjan's Strongly Connected Components algorithm.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-xs font-medium rounded-lg border border-slate-700 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Computing...' : 'Recompute Graph'}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/30 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Graph unavailable ({error.code || 'ERROR'})</div>
            <div className="mt-1">{error.detail}</div>
          </div>
        </div>
      )}

      {graphData && (
        <div className={`p-4 rounded-xl border flex items-center justify-between ${
          graphData.hasCycle
            ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
        }`}>
          <div className="flex items-center gap-3">
            {graphData.hasCycle
              ? <AlertCircle className="w-5 h-5 text-rose-400" />
              : <CheckCircle className="w-5 h-5 text-emerald-400" />}
            <div>
              <span className="font-semibold text-sm">
                {graphData.hasCycle
                  ? 'Cyclic dependency detected by Tarjan SCC'
                  : 'Acyclic directed topology (DAG verified)'}
              </span>
              <p className="text-xs opacity-80 mt-0.5">
                {graphData.hasCycle
                  ? `Identified ${graphData.cyclicComponents.length} strongly connected cycle(s): ${graphData.cyclicComponents.map(component => component.join(' ⇄ ')).join(', ')}`
                  : 'No strongly connected component contains more than one service.'}
              </p>
            </div>
          </div>
          <span className="text-xs font-mono px-3 py-1 bg-slate-900/60 rounded-full border border-slate-700">
            {graphData.sccs?.length || 0} Components
          </span>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex justify-center items-center shadow-inner overflow-x-auto min-h-[480px]">
        {loading ? (
          <div className="text-slate-400 text-sm animate-pulse">Computing Tarjan graph topology...</div>
        ) : !graphData ? (
          <div className="text-slate-400 text-sm">
            The graph could not be loaded. No fallback topology is displayed.
          </div>
        ) : (
          <svg width="700" height="460" className="select-none">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#6366f1" />
              </marker>
            </defs>

            {graphData.edges.map((edge, index) => {
              const start = coordinates[edge.from] || { x: 50, y: 50 };
              const end = coordinates[edge.to] || { x: 100, y: 100 };
              return (
                <g key={`edge-${edge.from}-${edge.to}-${index}`}>
                  <line
                    x1={start.x}
                    y1={start.y}
                    x2={end.x}
                    y2={end.y}
                    stroke="#4338ca"
                    strokeWidth="2"
                    strokeDasharray="4 2"
                    markerEnd="url(#arrow)"
                  />
                </g>
              );
            })}

            {graphData.nodes.map((node) => {
              const position = coordinates[node.id] || { x: 50, y: 50 };
              const cyclic = graphData.cyclicComponents?.some(component => component.includes(node.id));
              return (
                <g key={node.id} transform={`translate(${position.x}, ${position.y})`}>
                  <circle
                    r="24"
                    fill={cyclic ? '#7f1d1d' : '#1e1b4b'}
                    stroke={cyclic ? '#fb7185' : '#6366f1'}
                    strokeWidth="2.5"
                  />
                  <text
                    textAnchor="middle"
                    dy="4"
                    fill="#e2e8f0"
                    fontSize="10"
                    fontWeight="600"
                    fontFamily="monospace"
                  >
                    {node.id.split('-')[0]}
                  </text>
                  <text
                    textAnchor="middle"
                    dy="36"
                    fill="#94a3b8"
                    fontSize="11"
                    fontWeight="500"
                  >
                    {node.id}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-center gap-2 text-xs text-slate-400">
        <GitFork className="w-4 h-4 text-indigo-400" />
        Topology is computed by the analysis engine from its configured service graph; this page never substitutes a client-side graph.
      </div>
    </div>
  );
}
