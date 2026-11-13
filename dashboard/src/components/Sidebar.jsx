import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Activity,
  Server,
  GitFork,
  Layers,
  AlertTriangle,
  BarChart3,
  Zap,
  Settings,
  ShieldCheck,
  Search
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';
import { BrandLockup, Kbd, cn, modKeyLabel } from './ui.jsx';

const navGroups = [
  {
    label: 'Observe',
    items: [
      { path: '/', label: 'Overview', icon: Activity },
      { path: '/services', label: 'Services', icon: Server },
      { path: '/graph', label: 'Dependency Graph', icon: GitFork },
      { path: '/traces', label: 'Traces', icon: Layers },
      { path: '/incidents', label: 'Incidents', icon: AlertTriangle },
      { path: '/metrics', label: 'Metrics', icon: BarChart3 }
    ]
  },
  {
    label: 'Control',
    items: [
      { path: '/fault-injection', label: 'Fault Injection', icon: Zap },
      { path: '/settings', label: 'Settings', icon: Settings }
    ]
  }
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

export default function Sidebar({ onOpenCommand }) {
  const { session } = useAuth();
  const { pathname } = useLocation();
  const roleLabel = session?.role ? session.role.replace('ROLE_', '') : 'VIEWER';
  const initial = (session?.username || '?').slice(0, 1).toUpperCase();

  return (
    <aside className="relative z-20 hidden w-[272px] shrink-0 p-3 lg:block xl:w-[292px] xl:p-4">
      <div className="glass-panel-strong flex h-full flex-col overflow-hidden rounded-[28px]">
        <div className="flex items-center px-5 pb-4 pt-5">
          <BrandLockup subtitleClassName="lg:text-[8px] lg:tracking-[0.06em] xl:text-[9px] xl:tracking-[0.08em]" />
        </div>

        <button
          type="button"
          onClick={onOpenCommand}
          className="glass-pill mx-3 mb-2 flex h-9 items-center gap-2 rounded-full px-3 text-[11px] font-medium text-white/52 transition hover:text-white/86"
          aria-label="Open command palette"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Quick search</span>
          <Kbd>{modKeyLabel} K</Kbd>
        </button>

        <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Primary navigation">
          {navGroups.map((group) => (
            <div key={group.label} className="mb-5 last:mb-0">
              <p className="px-3 pb-2 font-mono text-[9px] font-medium uppercase tracking-[0.08em] text-white/34">
                {group.label}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isItemActive(pathname, item.path);
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.path === '/'}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group relative flex min-h-10 items-center gap-3 rounded-xl px-3 text-[12px] font-medium transition duration-200',
                        active
                          ? 'border border-signal-400/18 bg-gradient-to-r from-signal-500/[0.16] to-white/[0.025] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                          : 'border border-transparent text-white/54 hover:bg-white/[0.045] hover:text-white/84'
                      )}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-signal-400 shadow-[0_0_12px_rgba(255,45,85,0.85)]" />
                      )}
                      <Icon className={cn('h-4 w-4 shrink-0 transition', active ? 'text-signal-300' : 'text-white/44 group-hover:text-white/64')} />
                      <span className="truncate">{item.label}</span>
                      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-signal-400 shadow-[0_0_10px_rgba(255,45,85,0.8)]" />}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="px-4 pb-4 pt-2">
          <div className="rounded-2xl border border-white/[0.07] bg-black/25 p-3.5">
            <div className="flex items-center gap-2">
              <span className="live-dot" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/66">Local stack</span>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-white/40">
              Tempo traces · Prometheus signals · live probes
            </p>
          </div>

          <div className="mt-3 flex items-center gap-2.5 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-gradient-to-br from-signal-500/25 to-white/[0.04] text-[12px] font-semibold text-white/90">
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold text-white/78">{session?.username || 'Signed out'}</p>
              <p className="truncate text-[9px] font-medium uppercase tracking-[0.12em] text-white/40">{roleLabel}</p>
            </div>
            <ShieldCheck className="h-4 w-4 shrink-0 text-white/30" />
          </div>
        </div>
      </div>
    </aside>
  );
}
