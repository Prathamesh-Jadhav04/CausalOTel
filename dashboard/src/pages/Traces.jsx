import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  Filter,
  Layers,
  RefreshCw,
  Search
} from 'lucide-react';
import api from '../lib/api.js';
import { describeApiError, normalizeTracesResponse } from '../lib/contracts.js';
import { traceDetailPath } from '../lib/routes.js';
import {
  Badge,
  Button,
  Chip,
  CopyButton,
  EmptyState,
  ErrorBanner,
  GlassCard,
  MetaChip,
  PageHeader,
  SearchField,
  SkeletonRows,
  StatusBadge,
  cn
} from '../components/ui.jsx';

export default function Traces() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [traces, setTraces] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/analysis/traces', { params: { limit: 50 } });
      setTraces(normalizeTracesResponse(response.data));
      setError(null);
    } catch (err) {
      setTraces(null);
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = (traces || []).filter(trace => {
    const needle = searchTerm.toLowerCase();
    const matchesSearch =
      trace.traceId.toLowerCase().includes(needle) ||
      trace.rootOperation.toLowerCase().includes(needle) ||
      trace.rootService.toLowerCase().includes(needle);
    const matchesStatus = statusFilter === 'ALL' || trace.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const timestampLabel = (trace) => {
    if (!trace.startTimeUnixNano) {
      return '—';
    }
    const millis = Number(BigInt(trace.startTimeUnixNano) / 1_000_000n);
    return Number.isFinite(millis) ? new Date(millis).toLocaleString() : '—';
  };

  return (
    <div className="space-y-5 lg:space-y-6">
      <PageHeader
        eyebrow="Tempo search"
        title="Distributed traces"
        description="Tempo search results only. When Tempo is unavailable the page says so instead of showing fixtures."
        actions={
          <Button onClick={load} loading={loading} variant="secondary">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            {loading ? 'Loading' : 'Refresh'}
          </Button>
        }
        meta={
          <>
            <MetaChip icon={Layers}>{traces ? `${traces.length} traces loaded` : 'Awaiting Tempo'}</MetaChip>
            <MetaChip>limit: 50</MetaChip>
            <MetaChip icon={CheckCircle}>real spans only</MetaChip>
          </>
        }
      />

      {error && (
        <ErrorBanner
          title="Tempo unavailable"
          detail={error.detail}
          code={error.code || 'TEMPO_ERROR'}
        />
      )}

      <GlassCard className="p-3 sm:p-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SearchField
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search trace ID, endpoint, or service..."
              className="w-full sm:max-w-md"
              aria-label="Search traces"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="signal" dot>LIVE TRACE FEED</Badge>
              <span className="text-[10px] text-white/46">
                {filtered.length} of {traces?.length ?? 0} shown
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.065] pt-3">
            <span className="mr-1 inline-flex items-center gap-1.5 font-mono text-[9px] font-medium uppercase tracking-[0.08em] text-white/42">
              <Filter className="h-3.5 w-3.5" />
              Status
            </span>
            {['ALL', 'OK', 'ERROR', 'UNKNOWN'].map((status) => (
              <Chip key={status} active={statusFilter === status} onClick={() => setStatusFilter(status)}>
                {status}
              </Chip>
            ))}
          </div>
        </div>
      </GlassCard>

      <GlassCard className="overflow-hidden">
        <div className="hidden overflow-x-auto xl:block">
          <table className="w-full min-w-full text-left text-xs xl:min-w-[860px]">
            <thead className="border-b border-white/[0.07] bg-white/[0.025] text-[9px] font-semibold uppercase tracking-[0.16em] text-white/42">
              <tr>
                <th className="px-3 py-3.5 xl:px-5">Trace ID</th>
                <th className="px-3 py-3.5 xl:px-5">Root endpoint</th>
                <th className="px-3 py-3.5 xl:px-5">Service</th>
                <th className="px-3 py-3.5 xl:px-5">Duration</th>
                <th className="hidden px-3 py-3.5 xl:px-5 xl:table-cell">Started</th>
                <th className="px-3 py-3.5 xl:px-5">Status</th>
                <th className="px-3 py-3.5 xl:px-5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.055]">
              {filtered.map((trace) => (
                <tr key={trace.traceId} className="group transition hover:bg-white/[0.035]">
                  <td className="max-w-[240px] px-3 py-3.5 xl:px-5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 truncate font-mono text-[11px] font-semibold text-signal-300">{trace.traceId}</span>
                      <CopyButton compact value={trace.traceId} label="Copy trace ID" />
                    </div>
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-3.5 xl:px-5 font-medium text-white/80">{trace.rootOperation}</td>
                  <td className="px-3 py-3.5 xl:px-5">
                    <Badge>{trace.rootService}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3.5 xl:px-5 font-mono text-white/62">
                    {trace.durationMs === null ? '—' : `${trace.durationMs}ms`}
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-3.5 xl:px-5 text-white/48 xl:table-cell">{timestampLabel(trace)}</td>
                  <td className="px-3 py-3.5 xl:px-5">
                    <StatusBadge status={trace.status} />
                  </td>
                  <td className="px-3 py-3.5 xl:px-5 text-right">
                    <button
                      type="button"
                      onClick={() => navigate(traceDetailPath(trace.traceId))}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/56 transition group-hover:text-signal-300"
                    >
                      Inspect <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-white/[0.055] xl:hidden">
          {filtered.map((trace) => (
            <button
              key={trace.traceId}
              type="button"
              onClick={() => navigate(traceDetailPath(trace.traceId))}
              className="block w-full p-4 text-left transition active:bg-white/[0.035]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[10px] font-semibold text-signal-300">{trace.traceId}</p>
                  <p className="mt-1.5 text-[13px] font-semibold leading-snug text-white/88">{trace.rootOperation}</p>
                </div>
                <StatusBadge status={trace.status} className="shrink-0" />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-white/48">
                <Badge>{trace.rootService}</Badge>
                <span className="font-mono">{trace.durationMs === null ? '—' : `${trace.durationMs}ms`}</span>
                <span className="text-white/24">·</span>
                <span>{timestampLabel(trace)}</span>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[10px] text-white/34">Open trace waterfall</span>
                <ArrowRight className="h-4 w-4 text-white/34" />
              </div>
            </button>
          ))}
        </div>

        {loading && traces === null && (
          <div className="p-4">
            <SkeletonRows rows={5} />
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <EmptyState
            icon={Layers}
            title={traces?.length ? 'No traces match the search' : 'No traces found in Tempo'}
            description={traces?.length
              ? 'Adjust the search term to find a matching trace.'
              : 'Generate checkout traffic or verify the OTel Collector → Tempo pipeline.'}
            className="m-3 border-white/[0.07] sm:m-4"
          />
        )}
      </GlassCard>

      <div className="flex flex-wrap items-center gap-2 text-[10px] text-white/32">
        <AlertTriangle className="h-3.5 w-3.5" />
        Empty or unavailable results are surfaced explicitly; no fixture traces are injected.
      </div>
    </div>
  );
}
