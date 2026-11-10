import React from 'react';
import { Bell, RefreshCw, Radio } from 'lucide-react';

export default function Navbar({ onRefresh }) {
  return (
    <header className="h-16 bg-slate-900/60 backdrop-blur border-b border-slate-800 flex items-center justify-between px-8">
      <div className="flex items-center gap-3">
        <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
          OTel v1.38
        </span>
        <span className="text-xs text-slate-400 font-mono">
          Sweep-Line Interval Union C++20 / JS Engine
        </span>
      </div>

      <div className="flex items-center gap-4">
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg border border-slate-700 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        )}
        <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full">
          <Radio className="w-3.5 h-3.5 animate-pulse" />
          <span>OTel Collector: 4317/4318</span>
        </div>
      </div>
    </header>
  );
}
