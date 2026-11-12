import React, { useState } from 'react';
import { LogOut, ShieldCheck, User, X } from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';
import { Badge, BottomSheet, BrandLockup, Button, IconButton } from './ui.jsx';

export default function Navbar() {
  const { session, isAdmin, logout } = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);
  const initial = (session?.username || '?').slice(0, 1).toUpperCase();
  const roleLabel = session?.role ? session.role.replace('ROLE_', '') : 'VIEWER';

  return (
    <>
      <header className="topbar-glass relative z-30 flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-4 pb-2.5 pt-3 lg:hidden">
        <BrandLockup size="sm" />
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-white/50 sm:inline-flex">
            <span className="live-dot h-1.5 w-1.5" />
            Live
          </span>
          <button
            type="button"
            onClick={() => setAccountOpen(true)}
            aria-label="Open account menu"
            className="relative grid h-10 w-10 place-items-center rounded-full border border-white/12 bg-gradient-to-br from-signal-500/30 via-white/[0.06] to-white/[0.03] text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition active:scale-95"
          >
            <span className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_50%)]" />
            <span className="relative">{initial}</span>
            <span className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0b0b0e] bg-emerald-400" />
          </button>
        </div>
      </header>

      <header className="relative z-20 hidden h-[74px] shrink-0 items-center justify-between gap-4 px-7 lg:flex xl:px-9">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/54">
            <span className="live-dot h-1.5 w-1.5" />
            Local stack
          </span>
          <span className="text-[11px] text-white/34">Native Windows OTel pipeline</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2.5 rounded-full border border-white/[0.08] bg-white/[0.04] py-1.5 pl-1.5 pr-3">
            <span className="grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-gradient-to-br from-signal-500/30 to-white/[0.04] text-[10px] font-semibold text-white/90">
              {initial}
            </span>
            <span className="max-w-[140px] truncate text-[11px] font-medium text-white/70">{session.username}</span>
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
        <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-white/10 bg-gradient-to-br from-signal-500/35 to-white/[0.04] text-base font-semibold text-white">
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{session?.username}</p>
            <p className="mt-0.5 truncate text-[10px] uppercase tracking-[0.12em] text-white/44">{roleLabel}</p>
          </div>
          <Badge tone={isAdmin ? 'signal' : 'neutral'} dot>
            {isAdmin ? 'ADMIN' : roleLabel}
          </Badge>
        </div>

        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-black/20 p-3.5 text-xs">
            <span className="text-white/50">Role</span>
            <span className="font-mono text-white/74">{session?.role}</span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-black/20 p-3.5 text-xs">
            <span className="text-white/50">User ID</span>
            <span className="min-w-0 truncate font-mono text-white/74">{session?.userId}</span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-black/20 p-3.5 text-xs">
            <span className="text-white/50">Session</span>
            <span className="inline-flex items-center gap-1.5 text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              Verified
            </span>
          </div>
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
