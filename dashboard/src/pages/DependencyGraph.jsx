import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Clock,
  GitFork,
  Radio,
  RefreshCw
} from 'lucide-react';
import api from '../lib/api.js';
import { describeApiError } from '../lib/contracts.js';
import {
  Badge,
  Button,
  CardHeader,
  CopyButton,
  EmptyState,
  ErrorBanner,
  GlassCard,
  MetaChip,
  Notice,
  PageHeader,
  StatusBadge,
  cn,
  useMediaQuery
} from '../components/ui.jsx';

/* Node ring + label tints resolve through CSS variables so the graph stays
   legible on both the black and the white canvas. */
const HEALTH_TEXT_COLORS = {
  UP: 'var(--graph-up)',
  DOWN: 'var(--graph-down)',
  UNREACHABLE: 'var(--graph-unreachable)',
  UNKNOWN: 'var(--graph-unknown)'
};

function layoutNodes(nodes, compact) {
  const sparse = nodes.length <= 2;
  const width = compact ? 360 : 720;
  const height = compact ? (sparse ? 300 : 400) : (sparse ? 340 : 470);
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(
    82,
    Math.min(compact ? 130 : 185, 66 + nodes.length * (compact ? 9 : 13))
  );

  if (nodes.length === 2) {
    const spread = compact ? 92 : 150;
    return {
      width,
      height,
      positions: {
        [nodes[0].id]: { x: centerX - spread, y: centerY },
        [nodes[1].id]: { x: centerX + spread, y: centerY }
      }
    };
  }

  return {
    width,
    height,
    positions: Object.fromEntries(nodes.map((node, index) => {
      if (nodes.length === 1) {
        return [node.id, { x: centerX, y: centerY }];
      }
      const angle = ((2 * Math.PI * index) / nodes.length) - (Math.PI / 2);
      return [node.id, {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle)
      }];
    }))
  };
}

function shortName(service) {
  return service.replace(/-service$/, '');
}

export default function DependencyGraph() {
  const [graphData, setGraphData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [window, setWindow] = useState('15m');
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const compact = useMediaQuery('(max-width: 639px)');

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
    setSelectedNodeId(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window]);

  const layout = graphData ? layoutNodes(graphData.nodes, compact) : null;
  const isEmpty = graphData && graphData.traceCount === 0;
  const selectedNode = graphData?.nodes?.find((node) => node.id === selectedNodeId) || null;
  const sparseGraph = Boolean(graphData && graphData.nodes.length <= 2);
  const nodeRadius = sparseGraph ? (compact ? 31 : 37) : (compact ? 26 : 28);

  return (
    <div className="space-y-5 lg:space-y-6">
      <PageHeader
        eyebrow="Runtime topology"
        title="Dependency graph"
        description="Service dependencies derived from recent Tempo spans, with live health probes and Tarjan SCC cycle detection."
        actions={
          <>
            <div className="relative">
              <select
                value={window}
                onChange={(event) => setWindow(event.target.value)}
                className="h-10 appearance-none rounded-lg border border-white/[0.1] bg-surface-1/70 pl-3.5 pr-9 text-[13px] font-medium text-ink-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] outline-none backdrop-blur-xl transition hover:bg-white/[0.08] focus:border-signal-400/50 focus:ring-4 focus:ring-signal-500/10"
                aria-label="Graph time window"
              >
                <option value="15m">Last 15 minutes</option>
                <option value="1h">Last hour</option>
                <option value="6h">Last 6 hours</option>
                <option value="24h">Last 24 hours</option>
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[9px] text-ink-tertiary">▼</span>
            </div>
            <Button onClick={load} loading={loading} variant="secondary">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              {loading ? 'Loading' : 'Refresh graph'}
            </Button>
          </>
        }
      />

      {error && (
        <ErrorBanner
          title="Graph unavailable"
          detail={error.detail}
          code={error.code || 'ERROR'}
        >
          <div className="mt-1 text-[10px] text-rose-200/55">No static fallback topology is displayed.</div>
        </ErrorBanner>
      )}

      {graphData && (
        <div className="flex flex-wrap items-center gap-2">
          <MetaChip icon={Radio}>source: {graphData.source}</MetaChip>
          <MetaChip icon={Clock}>window: {graphData.window}</MetaChip>
          <MetaChip>{graphData.traceCount} traces / {graphData.spanCount} spans</MetaChip>
          <MetaChip>{graphData.edges.length} edges</MetaChip>
          <MetaChip>cache: {graphData.cache?.hit ? `hit (${graphData.cache.ageMs}ms old)` : 'fresh'}</MetaChip>
          {graphData.degraded && (
            <Badge tone="amber" dot>degraded · {graphData.failedTraceCount} trace(s) unavailable</Badge>
          )}
        </div>
      )}

      {graphData && !isEmpty && (
        <Notice tone={graphData.hasCycle ? 'error' : 'success'} icon={graphData.hasCycle ? AlertCircle : CheckCircle}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-semibold">
                {graphData.hasCycle
                  ? 'Cyclic dependency detected by Tarjan SCC'
                  : 'Acyclic topology in the selected trace window'}
              </p>
              <p className="mt-1 text-[11px] opacity-75">
                {graphData.hasCycle
                  ? `Identified ${graphData.cyclicComponents.length} strongly connected cycle(s): ${graphData.cyclicComponents.map(component => component.join(' ⇄ ')).join(', ')}`
                  : `No strongly connected component contains more than one service across ${graphData.traceCount} recent trace(s).`}
              </p>
            </div>
            <Badge tone={graphData.hasCycle ? 'rose' : 'emerald'} className="shrink-0">
              {graphData.sccs?.length || 0} components
            </Badge>
          </div>
        </Notice>
      )}

      {isEmpty && (
        <Notice tone="warning" icon={AlertCircle}>
          <p className="font-semibold">No recent traces in this window</p>
          <p className="mt-1 text-[11px] opacity-75">
            Tempo returned no traces for the last {graphData.window}. The graph is intentionally empty; no fallback
            topology is displayed.
          </p>
        </Notice>
      )}

      <GlassCard className="p-3 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-3">
          <div className="flex items-center gap-2">
            <Badge tone="emerald" dot>UP</Badge>
            <Badge tone="amber" dot>DOWN</Badge>
            <Badge tone="neutral" dot>UNKNOWN</Badge>
            <Badge tone="rose" dot>CYCLIC</Badge>
          </div>
          <p className="text-[10px] text-white/40">
            Tap a node to inspect its live probe and span counters
          </p>
        </div>

        <div className="glass-inset relative overflow-hidden rounded-2xl p-2 sm:p-4">
          {loading ? (
            <div className="flex min-h-[380px] items-center justify-center">
              <div className="flex items-center gap-2.5 text-xs text-white/50">
                <span className="live-dot is-signal" />
                Loading Tempo-derived topology...
              </div>
            </div>
          ) : !graphData ? (
            <div className="flex min-h-[380px] items-center justify-center px-6 text-center text-xs leading-relaxed text-white/46">
              The graph could not be loaded. No fallback topology is displayed.
            </div>
          ) : isEmpty ? (
            <div className="flex min-h-[380px] items-center justify-center px-6 text-center text-xs text-white/46">
              No dependency edges to render for this window.
            </div>
          ) : (
            <svg
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              preserveAspectRatio="xMidYMid meet"
              className="mx-auto block h-auto w-full max-w-[860px] select-none"
              role="img"
              aria-label="Service dependency graph"
            >
              <defs>
                <linearGradient id="edge-signal" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style={{ stopColor: 'var(--edge-a)', stopOpacity: 'var(--edge-opacity-a)' }} />
                  <stop offset="100%" style={{ stopColor: 'var(--edge-b)', stopOpacity: 'var(--edge-opacity-b)' }} />
                </linearGradient>
                <marker id="graph-arrow" viewBox="0 0 10 10" refX="20" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#6f7ae4" fillOpacity="0.7" style={{ fill: 'var(--edge-a)' }} />
                </marker>
                <marker id="graph-arrow-error" viewBox="0 0 10 10" refX="20" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#fb7185" style={{ fill: 'var(--graph-unreachable)' }} />
                </marker>
                <filter id="node-soft-glow" x="-60%" y="-60%" width="220%" height="220%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {graphData.edges.map((edge, index) => {
                const start = layout.positions[edge.from];
                const end = layout.positions[edge.to];
                if (!start || !end) return null;
                const strokeWidth = Math.min(4.5, 1 + Math.log2(edge.callCount + 1));
                const hasError = edge.errorCount > 0;
                return (
                  <g key={`edge-${edge.from}-${edge.to}-${index}`}>
                    <line
                      x1={start.x}
                      y1={start.y}
                      x2={end.x}
                      y2={end.y}
                      stroke={hasError ? '#fb7185' : 'url(#edge-signal)'}
                      style={hasError ? { stroke: 'var(--graph-unreachable)' } : undefined}
                      strokeWidth={strokeWidth}
                      strokeDasharray={hasError ? '6 4' : '4 3'}
                      strokeOpacity={hasError ? 0.9 : 0.75}
                      markerEnd={hasError ? 'url(#graph-arrow-error)' : 'url(#graph-arrow)'}
                    >
                      <title>{`${edge.from} → ${edge.to}: ${edge.callCount} call(s), ${edge.errorCount} error(s), avg ${edge.avgDurationMs}ms`}</title>
                    </line>
                  </g>
                );
              })}

              {graphData.nodes.map((node) => {
                const position = layout.positions[node.id];
                if (!position) return null;
                const cyclic = graphData.cyclicComponents?.some(component => component.includes(node.id));
                const healthStatus = node.health?.status || 'UNKNOWN';
                const stroke = cyclic
                  ? 'var(--graph-unreachable)'
                  : HEALTH_TEXT_COLORS[healthStatus] || 'var(--graph-unknown)';
                const selected = selectedNodeId === node.id;
                const fill = healthStatus === 'UP'
                  ? 'var(--graph-node-up)'
                  : healthStatus === 'DOWN'
                    ? 'var(--graph-node-down)'
                    : 'var(--graph-node)';

                return (
                  <g
                    key={node.id}
                    transform={`translate(${position.x}, ${position.y})`}
                    className="cursor-pointer"
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.id}: ${healthStatus}`}
                    onClick={() => setSelectedNodeId(node.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedNodeId(node.id);
                      }
                    }}
                  >
                    <circle r={nodeRadius + 8} fill="transparent" />
                    {selected && (
                      <circle r={nodeRadius + 7} fill="rgba(94,105,209,0.14)" stroke="rgba(130,143,255,0.4)" strokeWidth="1" />
                    )}
                    <circle
                      r={nodeRadius}
                      style={{ fill, stroke }}
                      strokeWidth={cyclic ? 3 : selected ? 2.6 : 2}
                      filter={selected ? 'url(#node-soft-glow)' : undefined}
                    >
                      <title>{`${node.id}: ${healthStatus}${node.health?.latencyMs != null ? ` (${node.health.latencyMs}ms)` : ''}, ${node.spanCount} spans, ${node.errorCount} errors`}</title>
                    </circle>
                    <text
                      textAnchor="middle"
                      dy="3.5"
                      fontSize={compact ? 9 : 10.5}
                      fontWeight="650"
                      fontFamily="monospace"
                      style={{ fill: 'var(--graph-node-ink)' }}
                    >
                      {shortName(node.id).slice(0, compact ? 10 : 12)}
                    </text>
                    <text
                      textAnchor="middle"
                      dy={nodeRadius + 14}
                      fontSize={compact ? 8 : 9}
                      fontWeight="600"
                      fontFamily="monospace"
                      style={{ fill: stroke }}
                    >
                      {healthStatus}
                    </text>
                    <text
                      textAnchor="middle"
                      dy={nodeRadius + 25}
                      fontSize={compact ? 7.5 : 8.5}
                      fontFamily="monospace"
                      style={{ fill: 'var(--graph-label)' }}
                    >
                      {node.id}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        {selectedNode && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="glass-inset rounded-lg p-3">
              <p className="font-mono text-[8px] font-medium uppercase tracking-[0.08em] text-white/36">Node</p>
              <div className="mt-1 flex items-center gap-1.5">
                <p className="min-w-0 break-all font-mono text-[11px] font-semibold text-white/84">{selectedNode.id}</p>
                <CopyButton compact value={selectedNode.id} label="Copy node ID" />
              </div>
            </div>
            <div className="glass-inset rounded-lg p-3">
              <p className="font-mono text-[8px] font-medium uppercase tracking-[0.08em] text-white/36">Health</p>
              <div className="mt-1.5"><StatusBadge status={selectedNode.health?.status || 'UNKNOWN'} /></div>
            </div>
            <div className="glass-inset rounded-lg p-3">
              <p className="font-mono text-[8px] font-medium uppercase tracking-[0.08em] text-white/36">Spans</p>
              <p className="mt-1 font-mono text-sm font-semibold text-white/84">{selectedNode.spanCount}</p>
            </div>
            <div className="glass-inset rounded-lg p-3">
              <p className="font-mono text-[8px] font-medium uppercase tracking-[0.08em] text-white/36">Errors</p>
              <p className={cn('mt-1 font-mono text-sm font-semibold', selectedNode.errorCount > 0 ? 'text-rose-300' : 'text-white/84')}>
                {selectedNode.errorCount}
              </p>
            </div>
          </div>
        )}
      </GlassCard>

      <GlassCard className="flex items-start gap-3 p-4 text-[11px] leading-relaxed text-white/44">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-white/54">
          <GitFork className="h-4 w-4" />
        </span>
        <p className="min-w-0">
          Topology is derived from real Tempo parent/child spans for the selected window; edge color and width
          reflect errors and call volume. This page never substitutes a client-side or static graph.
        </p>
      </GlassCard>
    </div>
  );
}
