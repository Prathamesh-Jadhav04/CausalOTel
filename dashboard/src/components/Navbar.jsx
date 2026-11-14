import React, { useState } from 'react';
import { LogOut, Search, ShieldCheck, User, X } from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';
import { useTheme } from '../lib/ThemeContext.jsx';
import { Badge, BottomSheet, BrandLockup, Button, CopyButton, IconButton, Kbd, modKeyLabel, ThemeToggle } from './ui.jsx';

export default function Navbar({ onOpenCommand }) {
  const { session, isAdmin, logout } = useAuth();
  const { theme } = useTheme();
  const [accountOpen, setAccountOpen] = useState(false);
  const initial = (session?.username || '?').slice(0, 1).toUpperCase();
  const roleLabel = session?.role ? session.role.replace('ROLE_', '') : 'VIEWER';

  return (
    <>
      <header className="topbar-glass relative z-30 flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-4 pb-2.5 pt-3 lg:hidden">
        <BrandLockup size="sm" />
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-subtle sm:inline-flex">
            <span className="live-dot h-1.5 w-1.5" />
            Live
          </span>
          <IconButton label="Open command palette" onClick={onOpenCommand} className="h-9 w-9">
            <Search className="h-4 w-4" />
          </IconButton>
          <ThemeToggle size="sm" />
          <button
            type="button"
            onClick={() => setAccountOpen(true)}
            aria-label="Open account menu"
            className="relative grid h-10 w-10 place-items-center rounded-full border border-white/12 bg-gradient-to-br from-signal-500/30 via-white/[0.06] to-white/[0.03] text-sm font-semibold text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition active:scale-95"
          >
            <span className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_50%)]" />
            <span className="relative">{initial}</span>
            <span className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full border-2 border-canvas bg-success" />
          </button>
        </div>
      </header>

      <header className="relative z-20 hidden h-[74px] shrink-0 items-center justify-between gap-4 px-7 lg:flex xl:px-9">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">
            <span className="live-dot h-1.5 w-1.5" />
            Local stack
          </span>
          <span className="text-[11px] text-ink-tertiary">Native Windows OTel pipeline</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenCommand}
            className="glass-pill group hidden h-9 items-center gap-2 rounded-lg px-3 text-[11px] font-medium text-ink-subtle transition hover:text-ink lg:flex"
            aria-label="Open command palette"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Search workspace</span>
            <Kbd className="hidden xl:inline-flex">{modKeyLabel} K</Kbd>
          </button>
          <ThemeToggle />
          <div className="flex items-center gap-2.5 rounded-full border border-white/[0.09] bg-white/[0.045] py-1.5 pl-1.5 pr-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl">
            <span className="grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-gradient-to-br from-signal-500/30 to-white/[0.04] text-[10px] font-semibold text-ink">
              {initial}
            </span>
            <span className="max-w-[140px] truncate text-[11px] font-medium text-ink-muted">{session.username}</span>
            <Badge tone={isAdmin ? 'signal' : 'neutral'} dot>
              {isAdmin ? 'ADMIN' : roleLabel}
            </Badge>
          </div>
          <IconButton label="Sign out" onClick={logout}>
            <LogOut className="h-4 w-4" />
          </IconButton>
        </div>
      </header>

      <BottomSheet
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        eyebrow="Signed-in session"
        title="Account"
      >
        <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.035] p-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-white/10 bg-gradient-to-br from-signal-500/35 to-white/[0.04] text-base font-semibold text-ink">
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{session?.username}</p>
            <p className="mt-0.5 truncate text-[10px] uppercase tracking-[0.12em] text-ink-subtle">{roleLabel}</p>
          </div>
          <Badge tone={isAdmin ? 'signal' : 'neutral'} dot>
            {isAdmin ? 'ADMIN' : roleLabel}
          </Badge>
        </div>

        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-inset p-3.5 text-xs">
            <span className="text-ink-subtle">Appearance</span>
            <span className="flex items-center gap-2.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
                {theme === 'dark' ? 'Dark' : 'Light'}
              </span>
              <ThemeToggle size="sm" />
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-inset p-3.5 text-xs">
            <span className="text-ink-subtle">Role</span>
            <span className="font-mono text-ink-muted">{session?.role}</span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-inset p-3.5 text-xs">
            <span className="text-ink-subtle">User ID</span>
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate font-mono text-ink-muted">{session?.userId}</span>
              <CopyButton compact value={session?.userId} label="Copy user ID" />
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-inset p-3.5 text-xs">
            <span className="text-ink-subtle">Session</span>
            <span className="inline-flex items-center gap-1.5 text-success">
              <ShieldCheck className="h-3.5 w-3.5" />
              Verified
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setAccountOpen(false);
              onOpenCommand?.();
            }}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-hairline bg-inset p-3.5 text-xs text-ink-subtle transition hover:border-hairline-strong hover:bg-white/[0.045] hover:text-ink"
          >
            <span className="inline-flex items-center gap-2">
              <Search className="h-3.5 w-3.5" />
              Quick search
            </span>
            <Kbd>{modKeyLabel} K</Kbd>
          </button>
        </div>

        <Button
          variant="secondary"
          className="mt-4 w-full"
          onClick={() => {
            setAccountOpen(false);
            logout();
          }}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </BottomSheet>
    </>
  );
}
