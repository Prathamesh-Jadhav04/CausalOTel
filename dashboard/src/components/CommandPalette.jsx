import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Check,
  Copy,
  CornerDownLeft,
  GitFork,
  Layers,
  LogOut,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';
import { rcaDetailPath, traceDetailPath } from '../lib/routes.js';
import { Kbd, cn, modKeyLabel } from './ui.jsx';

const NAV_COMMANDS = [
  { id: 'overview', label: 'Overview', hint: 'Live system pulse and checkout saga', path: '/', icon: Activity, keywords: 'home status health services incidents' },
  { id: 'services', label: 'Services', hint: 'Health probes and runtime registry', path: '/services', icon: Server, keywords: 'registry probes ports runtime' },
  { id: 'graph', label: 'Dependency graph', hint: 'Tempo-derived service topology', path: '/graph', icon: GitFork, keywords: 'topology edges cycles scc' },
  { id: 'traces', label: 'Traces', hint: 'Tempo trace search and waterfall', path: '/traces', icon: Layers, keywords: 'tempo spans waterfall trace id' },
  { id: 'incidents', label: 'Incidents', hint: 'Durable RCA incident ledger', path: '/incidents', icon: AlertTriangle, keywords: 'rca root cause active resolved' },
  { id: 'metrics', label: 'Metrics', hint: 'Prometheus rates and latency', path: '/metrics', icon: BarChart3, keywords: 'promql p99 latency error rate' },
  { id: 'fault-injection', label: 'Fault injection', hint: 'Admin-only bounded chaos controls', path: '/fault-injection', icon: Zap, keywords: 'chaos admin payment inventory' },
  { id: 'settings', label: 'Settings', hint: 'Registry, telemetry ports, native core', path: '/settings', icon: Settings, keywords: 'ports storage native build' }
];

const GROUP_ORDER = ['Navigate', 'Open', 'Actions'];

export default function CommandPalette({ open, onClose, onOpen }) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [status, setStatus] = useState('');
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const closeTimerRef = useRef(null);

  useEffect(() => {
    const handleKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (open) onClose?.();
        else onOpen?.();
      }
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose, onOpen]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
      setStatus('');
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);

  const commands = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (command) => !needle || `${command.label} ${command.hint} ${command.keywords || ''}`.toLowerCase().includes(needle);
    const items = NAV_COMMANDS
      .filter(matches)
      .map((command) => ({ ...command, group: 'Navigate' }));

    const trimmed = query.trim();
    if (/^[a-f0-9]{32}$/i.test(trimmed)) {
      items.unshift({
        id: `trace-${trimmed}`,
        label: `Open trace ${trimmed.slice(0, 10)}…`,
        hint: 'Jump directly to the Tempo trace waterfall',
        icon: Layers,
        group: 'Open',
        run: () => navigate(traceDetailPath(trimmed))
      });
    }
    if (/^inc-[a-z0-9-]+$/i.test(trimmed)) {
      items.unshift({
        id: `incident-${trimmed}`,
        label: `Open incident ${trimmed}`,
        hint: 'Jump directly to the recorded RCA evidence',
        icon: AlertTriangle,
        group: 'Open',
        run: () => navigate(rcaDetailPath(trimmed))
      });
    }

    const actions = [
      {
        id: 'copy-url',
        label: 'Copy current URL',
        hint: window.location.href,
        icon: Copy,
        group: 'Actions',
        keywords: 'link clipboard share',
        run: async () => {
          try {
            await navigator.clipboard.writeText(window.location.href);
            setStatus('URL copied');
            closeTimerRef.current = window.setTimeout(() => onClose?.(), 550);
          } catch {
            setStatus('Clipboard unavailable');
          }
        }
      },
      {
        id: 'sign-out',
        label: 'Sign out',
        hint: 'End the local dashboard session',
        icon: LogOut,
        group: 'Actions',
        keywords: 'logout leave account',
        run: () => logout()
      }
    ].filter(matches);

    return [...items, ...actions];
  }, [query, navigate, logout, onClose]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const element = listRef.current?.querySelector(`[data-command-index="${activeIndex}"]`);
    element?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  if (!open) return null;

  const grouped = GROUP_ORDER
    .map((group) => ({ group, items: commands.filter((command) => command.group === group) }))
    .filter((entry) => entry.items.length > 0);

  const runCommand = (command) => {
    if (!command) return;
    if (command.path) {
      navigate(command.path);
      onClose?.();
      return;
    }
    command.run?.();
  };

  const handleInputKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(commands.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runCommand(commands[activeIndex]);
    }
  };

  let commandIndex = -1;

  return createPortal(
    <div className="fixed inset-0 z-[110]">
      <div className="sheet-backdrop absolute inset-0 bg-black/65 backdrop-blur-2xl" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="absolute inset-x-3 top-[8vh] mx-auto max-w-xl animate-scale-in overflow-hidden rounded-[28px] border border-white/15 bg-[#101015]/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_50px_120px_-30px_rgba(0,0,0,0.98)] backdrop-blur-3xl sm:inset-x-6 sm:top-[12vh]"
      >
        <div className="flex items-center gap-3 border-b border-white/[0.09] px-4 py-3.5 sm:px-5">
          <Search className="h-4 w-4 shrink-0 text-white/44" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search or paste an ID…"
            aria-label="Search commands"
            aria-controls="command-results"
            aria-activedescendant={commands[activeIndex] ? `command-${commands[activeIndex].id}` : undefined}
            className="h-7 min-w-0 flex-1 bg-transparent text-[14px] text-white/92 outline-none placeholder:text-white/30"
          />
          <Kbd>ESC</Kbd>
        </div>

        <div id="command-results" ref={listRef} role="listbox" aria-label="Commands" className="max-h-[52dvh] overflow-y-auto p-2 sm:max-h-[58dvh]">
          {grouped.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-semibold text-white/72">No matching commands</p>
              <p className="mt-1 text-[11px] text-white/42">Try a route name, a 32-character trace ID, or an incident ID.</p>
            </div>
          ) : grouped.map(({ group, items }) => (
            <div key={group} className="mb-1 last:mb-0">
              <p className="px-3 pb-1.5 pt-2 font-mono text-[9px] font-medium uppercase tracking-[0.08em] text-white/36">{group}</p>
              {items.map((command) => {
                commandIndex += 1;
                const index = commandIndex;
                const Icon = command.icon;
                const active = index === activeIndex;
                return (
                  <button
                    key={command.id}
                    id={`command-${command.id}`}
                    data-command-index={index}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => runCommand(command)}
                    className={cn(
                      'group flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition',
                      active
                        ? 'border-white/12 bg-white/[0.085] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                        : 'border-transparent hover:bg-white/[0.045]'
                    )}
                  >
                    <span className={cn(
                      'grid h-9 w-9 shrink-0 place-items-center rounded-xl border transition',
                      active
                        ? 'border-signal-400/25 bg-signal-500/12 text-signal-300'
                        : 'border-white/[0.08] bg-white/[0.045] text-white/50'
                    )}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold text-white/88">{command.label}</span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-white/40">{command.hint}</span>
                    </span>
                    {active ? <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-white/40" /> : <ArrowRight className="h-3.5 w-3.5 shrink-0 text-white/20" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] px-4 py-2.5 text-[10px] text-white/38 sm:px-5">
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-signal-400/80" />
            {status || 'CausalOTel workspace'}
          </span>
          <span className="hidden items-center gap-2 sm:inline-flex">
            <span className="inline-flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
            <span className="inline-flex items-center gap-1"><Kbd>Enter</Kbd> open</span>
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
