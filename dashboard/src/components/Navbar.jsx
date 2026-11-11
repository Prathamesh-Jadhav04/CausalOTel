import React from 'react';
import { LogOut, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';

export default function Navbar() {
  const { session, isAdmin, logout } = useAuth();

  return (
    <header className="h-16 bg-slate-900/60 backdrop-blur border-b border-slate-800 flex items-center justify-between px-8">
      <div className="flex items-center gap-3">
        <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
          Local stack
        </span>
        <span className="text-xs text-slate-400 font-mono">
          Native Windows OTel pipeline
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-xs text-slate-300 bg-slate-800/60 border border-slate-700 px-3 py-1.5 rounded-full">
          {isAdmin ? <ShieldCheck className="w-3.5 h-3.5 text-amber-400" /> : <User className="w-3.5 h-3.5 text-indigo-400" />}
          <span className="font-mono">{session.username}</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
            isAdmin ? 'bg-amber-500/10 text-amber-300 border border-amber-500/30' : 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/30'
          }`}>
            {session.role}
          </span>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg border border-slate-700 transition"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign out
        </button>
      </div>
    </header>
  );
}
