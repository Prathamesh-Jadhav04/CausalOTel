import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Activity,
  Server,
  Layers,
  AlertTriangle,
  Menu,
  GitFork,
  BarChart3,
  Zap,
  Settings,
  LogOut,
  ChevronRight,
  Search
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';
import { Badge, BottomSheet, Button, Kbd, cn, modKeyLabel } from './ui.jsx';

const primaryItems = [
  { path: '/', label: 'Overview', icon: Activity },
  { path: '/services', label: 'Services', icon: Server },
  { path: '/traces', label: 'Traces', icon: Layers },
  { path: '/incidents', label: 'Incidents', icon: AlertTriangle }
];

const moreItems = [
  { path: '/graph', label: 'Dependency Graph', hint: 'Tempo-derived topology', icon: GitFork },
  { path: '/metrics', label: 'Metrics', hint: 'Prometheus service signals', icon: BarChart3 },
  { path: '/fault-injection', label: 'Fault Injection', hint: 'Admin-only chaos controls', icon: Zap },
  { path: '/settings', label: 'Settings', hint: 'Registry and telemetry ports', icon: Settings }
];

function isItemActive(pathname, path) {
  if (path === '/') return pathname === '/';
  if (path === '/incidents') {
    return pathname === '/incidents' || pathname.startsWith('/incidents/') || pathname.startsWith('/rca');
  }
  if (path === '/traces') {
    return pathname === '/traces' || pathname.startsWith('/traces/');
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

export default function BottomNav({ onOpenCommand }) {
  const { pathname } = useLocation();
  const { session, logout } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const initial = (session?.username || '?').slice(0, 1).toUpperCase();
  const moreActive = moreItems.some((item) => isItemActive(pathname, item.path));

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  return (
    <>
      <nav
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] lg:hidden"
        aria-label="Primary navigation"
      >
        <div className="bottom-nav pointer-events-auto grid w-full max-w-md grid-cols-5 gap-0.5 rounded-2xl p-1.5 sm:max-w-lg">
          {primaryItems.map((item) => {
            const Icon = item.icon;
            const active = isItemActive(pathname, item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                aria-current={active ? 'page' : undefined}
                className="group flex min-h-[54px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 transition active:scale-[0.97]"
              >
                <span
                  className={cn(
                    'grid h-8 w-8 place-items-center rounded-full transition duration-200',
                    active
                      ? 'bg-gradient-to-b from-signal-400 to-signal-600 text-white shadow-[0_0_24px_rgba(94,105,209,0.5)]'
                      : 'text-ink-subtle group-hover:bg-white/[0.06] group-hover:text-ink'
                  )}
                >
                  <Icon className="h-[17px] w-[17px]" strokeWidth={active ? 2.3 : 2} />
                </span>
                <span
                  className={cn(
                    'max-w-full truncate text-[10px] font-semibold tracking-[0.02em] transition',
                    active ? 'text-ink' : 'text-ink-tertiary'
                  )}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className="group flex min-h-[54px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 transition active:scale-[0.97]"
          >
            <span
              className={cn(
                'grid h-8 w-8 place-items-center rounded-full transition duration-200',
                moreActive
                  ? 'bg-gradient-to-b from-signal-400 to-signal-600 text-white shadow-[0_0_22px_rgba(94,105,209,0.5)]'
                  : 'text-ink-subtle group-hover:bg-white/[0.06] group-hover:text-ink'
              )}
            >
              <Menu className="h-[17px] w-[17px]" strokeWidth={moreActive ? 2.3 : 2} />
            </span>
            <span className={cn('text-[10px] font-semibold tracking-[0.02em] transition', moreActive ? 'text-ink' : 'text-ink-tertiary')}>
              More
            </span>
          </button>
        </div>
      </nav>

      <BottomSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        eyebrow="Navigate"
        title="More workspace"
        footer={
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 bg-gradient-to-br from-signal-500/30 to-white/[0.04] text-xs font-semibold text-ink">
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-ink">{session?.username}</p>
              <p className="mt-0.5 truncate text-[9px] uppercase tracking-[0.12em] text-ink-tertiary">{session?.role}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setMoreOpen(false);
                logout();
              }}
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>
        }
      >
        <div className="grid gap-2">
          <button
            type="button"
            onClick={() => {
              setMoreOpen(false);
              onOpenCommand?.();
            }}
            className="flex items-center gap-3 rounded-xl border border-hairline bg-white/[0.03] p-3.5 text-left transition hover:border-hairline-strong hover:bg-white/[0.055]"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-ink-subtle">
              <Search className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-ink">Quick search</p>
              <p className="mt-0.5 text-[10px] text-ink-subtle">Pages, trace IDs, incidents, actions</p>
            </div>
            <Kbd>{modKeyLabel} K</Kbd>
          </button>
          {moreItems.map((item) => {
            const Icon = item.icon;
            const active = isItemActive(pathname, item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMoreOpen(false)}
                className={cn(
                  'group flex items-center gap-3 rounded-xl border p-3.5 transition',
                  active
                    ? 'border-signal-400/30 bg-signal-500/[0.12]'
                    : 'border-hairline bg-white/[0.03] hover:border-hairline-strong hover:bg-white/[0.055]'
                )}
              >
                <span
                  className={cn(
                    'grid h-10 w-10 shrink-0 place-items-center rounded-lg border transition',
                    active
                      ? 'border-signal-400/30 bg-signal-500/15 text-signal-300'
                      : 'border-white/[0.08] bg-white/[0.04] text-ink-subtle group-hover:text-ink-muted'
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-ink">{item.label}</p>
                  <p className="mt-0.5 text-[10px] text-ink-subtle">{item.hint}</p>
                </div>
                {active ? <Badge tone="signal">CURRENT</Badge> : <ChevronRight className="h-4 w-4 text-ink-tertiary" />}
              </Link>
            );
          })}
        </div>
      </BottomSheet>
    </>
  );
}
