import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  Activity, 
  Server, 
  GitFork, 
  Layers, 
  AlertTriangle, 
  Search, 
  BarChart3, 
  Zap, 
  Settings,
  ShieldCheck
} from 'lucide-react';

const navItems = [
  { path: '/', label: 'Overview', icon: Activity },
  { path: '/services', label: 'Services', icon: Server },
  { path: '/graph', label: 'Dependency Graph', icon: GitFork },
  { path: '/traces', label: 'Traces', icon: Layers },
  { path: '/incidents', label: 'Incidents', icon: AlertTriangle },
  { path: '/metrics', label: 'Metrics', icon: BarChart3 },
  { path: '/fault-injection', label: 'Fault Injection', icon: Zap },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar() {
  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col h-screen select-none">
      <div className="h-16 flex items-center px-6 gap-3 border-b border-slate-800">
        <div className="p-2 bg-indigo-500/10 border border-indigo-500/30 rounded-lg text-indigo-400">
          <ShieldCheck className="w-6 h-6 text-indigo-400" />
        </div>
        <div>
          <h1 className="font-bold text-slate-100 text-lg tracking-wide leading-tight">CausalOTel</h1>
          <p className="text-xs text-indigo-400 font-medium">Root Cause Observability</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`
              }
            >
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800">
        <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-800/40 rounded-lg border border-slate-700/50">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
          <span className="text-xs text-slate-300 font-mono">Agent: Online (Windows Host)</span>
        </div>
      </div>
    </aside>
  );
}
