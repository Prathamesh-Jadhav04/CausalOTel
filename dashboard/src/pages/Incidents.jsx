import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Database,
  Filter,
  RefreshCw,
  Server
} from 'lucide-react';
import api from '../lib/api.js';
import { rcaDetailPath } from '../lib/routes.js';
import { describeApiError, normalizeIncidentList } from '../lib/contracts.js';
import {
  Badge,
  Button,
  Chip,
  EmptyState,
  ErrorBanner,
  GlassCard,
  LoadingBlock,
  MetaChip,
  PageHeader,
  SearchField,
  StatusBadge,
  cn
} from '../components/ui.jsx';

export default function Incidents() {
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState(null);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/analysis/incidents', { params: { limit: 200 } });
      setIncidents(normalizeIncidentList(response.data));
      setError(null);
    } catch (err) {
      setIncidents(null);
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredIncidents = (incidents || []).filter((incident) => {
    const needle = searchTerm.toLowerCase();
    const matchesSearch =
      incident.incidentId.toLowerCase().includes(needle) ||
      incident.culpritService.toLowerCase().includes(needle) ||
      incident.rootCauseType.toLowerCase().includes(needle);
    const matchesStatus = statusFilter === 'ALL' || incident.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-5 lg:space-y-6">
      <PageHeader
        eyebrow="Incident ledger"
        title="Causal incidents"
        description="Durable incident records produced by real trace analysis. No seeded or fabricated incidents."
        actions={
          <Button onClick={load} loading={loading} variant="secondary">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            {loading ? 'Refreshing' : 'Refresh incidents'}
          </Button>
        }
        meta={
          <>
            <MetaChip icon={Database}>{incidents ? `${incidents.length} recorded` : 'Store loading'}</MetaChip>
            <MetaChip icon={AlertTriangle}>
              {incidents ? `${incidents.filter(incident => incident.status === 'ACTIVE').length} active` : '— active'}
            </MetaChip>
          </>
        }
      />

      {error && (
        <ErrorBanner
          title="Incident store unavailable"
          detail={error.detail}
          code={error.code || 'ERROR'}
        />
      )}

      <GlassCard className="p-3.5 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <SearchField
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search incident ID, culprit service, or root cause..."
            className="w-full lg:max-w-md"
            aria-label="Search incidents"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
              <Filter className="h-3.5 w-3.5" />
              Status
            </span>
            {['ALL', 'ACTIVE', 'RESOLVED'].map((status) => (
              <Chip key={status} active={statusFilter === status} onClick={() => setStatusFilter(status)}>
                {status}
              </Chip>
            ))}
          </div>
        </div>
      </GlassCard>

      <div className="space-y-3">
        {loading && incidents === null ? (
          <LoadingBlock label="Loading incident records..." />
        ) : filteredIncidents.length === 0 ? (
          <EmptyState
            icon={Database}
            title={incidents?.length ? 'No incidents match the filters' : 'No incidents recorded'}
            description={incidents?.length
              ? 'Adjust the search term or status filter.'
              : 'Incidents appear only after a real Tempo trace is analyzed from the Traces page.'}
            action={!incidents?.length ? (
              <Button variant="primary" onClick={() => navigate('/traces')}>
                Browse Tempo traces <ArrowRight className="h-4 w-4" />
              </Button>
            ) : null}
            className="py-16"
          />
        ) : (
          filteredIncidents.map((incident, index) => {
            const severityTone = incident.severity === 'CRITICAL'
              ? 'bg-rose-400'
              : incident.severity === 'HIGH'
                ? 'bg-amber-400'
                : 'bg-signal-400';

            return (
              <GlassCard
                key={incident.incidentId}
                interactive
                className={cn('relative overflow-hidden p-4 sm:p-5', index < 3 ? 'stagger-1' : 'stagger-2', 'animate-fade-up')}
              >
                <span className={cn('absolute bottom-5 left-0 top-5 w-[2px] rounded-full', severityTone)} />
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] font-semibold text-white/90">{incident.incidentId}</span>
                      <StatusBadge status={incident.severity} />
                      <StatusBadge status={incident.status} />
                      {incident.createdAt && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-white/42">
                          <Clock className="h-3 w-3" />
                          {new Date(incident.createdAt).toLocaleString()}
                        </span>
                      )}
                    </div>

                    <p className="max-w-4xl text-[13px] leading-relaxed text-white/70">{incident.summary}</p>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[10px] text-white/46">
                      <span className="inline-flex items-center gap-1.5">
                        <Server className="h-3.5 w-3.5 text-white/40" />
                        Culprit
                        <span className="font-mono font-semibold text-signal-300">{incident.culpritService}</span>
                      </span>
                      <span className="text-white/20">·</span>
                      <span className="font-mono">{incident.rootCauseType}</span>
                      <span className="text-white/20">·</span>
                      <span>
                        Confidence
                        <span className="ml-1 font-semibold text-emerald-300">
                          {incident.confidenceScore === null
                            ? 'not scored'
                            : `${(incident.confidenceScore * 100).toFixed(0)}%`}
                        </span>
                      </span>
                      {incident.traceId && (
                        <>
                          <span className="text-white/20">·</span>
                          <span className="break-all font-mono text-white/40">Trace {incident.traceId}</span>
                        </>
                      )}
                      {!incident.metricsAvailable && (
                        <Badge tone="amber">Prometheus correlation unavailable</Badge>
                      )}
                    </div>
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate(rcaDetailPath(incident.incidentId))}
                    className="w-full shrink-0 lg:w-auto"
                  >
                    Inspect RCA
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </GlassCard>
            );
          })
        )}
      </div>
    </div>
  );
}
