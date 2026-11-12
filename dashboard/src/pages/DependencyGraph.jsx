import React, { useEffect, useState } from 'react';
import { GitFork, AlertCircle, CheckCircle, RefreshCw, Clock, Radio } from 'lucide-react';
import api from '../lib/api.js';
import { describeApiError } from '../lib/contracts.js';

const HEALTH_COLORS = {
  UP: '#34d399',
  DOWN: '#fb7185',
  UNREACHABLE: '#fb7185',
  UNKNOWN: '#64748b'
};

function layoutNodes(nodes) {
  const width = 700;
  const height = 460;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(90, Math.min(185, 70 + nodes.length * 12));

  return Object.fromEntries(nodes.map((node, index) => {
    if (nodes.length === 1) {
      return [node.id, { x: centerX, y: centerY }];
    }
    const angle = ((2 * Math.PI * index) / nodes.length) - (Math.PI / 2);
    return [node.id, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle)
    }];
  }));
}

function shortName(service) {
  return service.replace(/-service$/, '');
}

export default function DependencyGraph() {
  const [graphData, setGraphData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [window, setWindow] = useState('15m');

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/analysis/graph', { params: { window } });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window]);

  const positions = graphData ? layoutNodes(graphData.nodes) : {};
  const isEmpty = graphData && graphData.traceCount === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight">Dependency Graph Topology</h2>
          <p className="text-sm text-slate-400 mt-1">
            Runtime service dependencies derived from recent Tempo spans, with live health probes and
            Tarjan SCC cycle detection.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={window}
            onChange={(event) => setWindow(event.target.value)}
            className="px-3 py-1.5 bg-slate-900 text-slate-300 text-xs rounded-lg border border-slate-700"
            aria-label="Graph time window"
          >
            <option value="15m">Last 15 minutes</option>
            <option value="1h">Last hour</option>
            <option value="6h">Last 6 hours</option>
            <option value="24h">Last 24 hours</option>
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-xs font-medium rounded-lg border border-slate-700 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Loading...' : 'Refresh Graph'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/30 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Graph unavailable ({error.code || 'ERROR'})</div>
            <div className="mt-1">{error.detail}</div>
            <div className="mt-1 opacity-80">No static fallback topology is displayed.</div>
          </div>
        </div>
      )}

      {graphData && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-400">
          <span className="px-2.5 py-1 rounded-full bg-slate-900 border border-slate-700 flex items-center gap-1.5">
            <Radio className="w-3 h-3 text-indigo-400" /> source: {graphData.source}
          </span>
          <span className="px-2.5 py-1 rounded-full bg-slate-900 border border-slate-700 flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-indigo-400" /> window: {graphData.window}
          </span>
          <span className="px-2.5 py-1 rounded-full bg-slate-900 border border-slate-700">
            {graphData.traceCount} traces / {graphData.spanCount} spans
          </span>
          <span className="px-2.5 py-1 rounded-full bg-slate-900 border border-slate-700">
            {graphData.edges.length} edges
          </span>
          <span className="px-2.5 py-1 rounded-full bg-slate-900 border border-slate-700">
            cache: {graphData.cache?.hit ? `hit (${graphData.cache.ageMs}ms old)` : 'fresh'}
          </span>
          {graphData.degraded && (
            <span className="px-2.5 py-1 rounded-full bg-amber-950/50 border border-amber-800 text-amber-300">
              degraded: {graphData.failedTraceCount} trace(s) unavailable
            </span>
          )}
        </div>
      )}

      {graphData && !isEmpty && (
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
                  : 'Acyclic topology in the selected trace window'}
              </span>
              <p className="text-xs opacity-80 mt-0.5">
                {graphData.hasCycle
                  ? `Identified ${graphData.cyclicComponents.length} strongly connected cycle(s): ${graphData.cyclicComponents.map(component => component.join(' ⇄ ')).join(', ')}`
                  : `No strongly connected component contains more than one service across ${graphData.traceCount} recent trace(s).`}
              </p>
            </div>
          </div>
          <span className="text-xs font-mono px-3 py-1 bg-slate-900/60 rounded-full border border-slate-700">
            {graphData.sccs?.length || 0} Components
          </span>
        </div>
      )}

      {isEmpty && (
        <div className="p-4 bg-amber-950/30 border border-amber-800 rounded-xl text-xs text-amber-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">No recent traces in this window</div>
            <div className="mt-1">
              Tempo returned no traces for the last {graphData.window}. The graph is intentionally empty;
              no fallback topology is displayed.
            </div>
          </div>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex justify-center items-center shadow-inner overflow-x-auto min-h-[480px]">
        {loading ? (
          <div className="text-slate-400 text-sm animate-pulse">Loading Tempo-derived topology...</div>
        ) : !graphData ? (
          <div className="text-slate-400 text-sm">
            The graph could not be loaded. No fallback topology is displayed.
          </div>
        ) : isEmpty ? (
          <div className="text-slate-400 text-sm">No dependency edges to render for this window.</div>
        ) : (
          <svg width="700" height="460" className="select-none">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#6366f1" />
              </marker>
            </defs>

            {graphData.edges.map((edge, index) => {
              const start = positions[edge.from];
              const end = positions[edge.to];
              if (!start || !end) return null;
              const strokeWidth = Math.min(5, 1 + Math.log2(edge.callCount + 1));
              return (
                <g key={`edge-${edge.from}-${edge.to}-${index}`}>
                  <line
                    x1={start.x}
                    y1={start.y}
                    x2={end.x}
                    y2={end.y}
                    stroke={edge.errorCount > 0 ? '#fb7185' : '#4338ca'}
                    strokeWidth={strokeWidth}
                    strokeDasharray={edge.errorCount > 0 ? '6 3' : '4 2'}
                    markerEnd="url(#arrow)"
                  >
                    <title>{`${edge.from} → ${edge.to}: ${edge.callCount} call(s), ${edge.errorCount} error(s), avg ${edge.avgDurationMs}ms`}</title>
                  </line>
                </g>
              );
            })}

            {graphData.nodes.map((node) => {
              const position = positions[node.id];
              if (!position) return null;
              const cyclic = graphData.cyclicComponents?.some(component => component.includes(node.id));
              const healthStatus = node.health?.status || 'UNKNOWN';
              const stroke = cyclic ? '#fb7185' : HEALTH_COLORS[healthStatus] || HEALTH_COLORS.UNKNOWN;
              return (
                <g key={node.id} transform={`translate(${position.x}, ${position.y})`}>
                  <circle
                    r="26"
                    fill={healthStatus === 'UP' ? '#052e16' : healthStatus === 'UNKNOWN' ? '#1e1b4b' : '#450a0a'}
                    stroke={stroke}
                    strokeWidth={cyclic ? 4 : 2.5}
                  >
                    <title>{`${node.id}: ${healthStatus}${node.health?.latencyMs != null ? ` (${node.health.latencyMs}ms)` : ''}, ${node.spanCount} spans, ${node.errorCount} errors`}</title>
                  </circle>
                  <text
                    textAnchor="middle"
                    dy="4"
                    fill="#e2e8f0"
                    fontSize="9"
                    fontWeight="600"
                    fontFamily="monospace"
                  >
                    {shortName(node.id).slice(0, 9)}
                  </text>
                  <text
                    textAnchor="middle"
                    dy="40"
                    fill="#94a3b8"
                    fontSize="10"
                    fontWeight="500"
                  >
                    {node.id}
                  </text>
                  <text
                    textAnchor="middle"
                    dy="54"
                    fill={stroke}
                    fontSize="9"
                    fontFamily="monospace"
                  >
                    {healthStatus}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-center gap-2 text-xs text-slate-400">
        <GitFork className="w-4 h-4 text-indigo-400" />
        Topology is derived from real Tempo parent/child spans for the selected window; edge color and
        width reflect errors and call volume. This page never substitutes a client-side or static graph.
      </div>
    </div>
  );
}
