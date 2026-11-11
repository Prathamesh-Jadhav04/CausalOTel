import React, { useState } from 'react';
import { ShieldCheck, LogIn, UserPlus, KeyRound, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';
import { describeApiError } from '../lib/contracts.js';

const TABS = [
  { id: 'login', label: 'Sign in', icon: LogIn },
  { id: 'register', label: 'Create account', icon: UserPlus },
  { id: 'bootstrap', label: 'Admin setup', icon: KeyRound }
];

export default function Login() {
  const { login, register, bootstrapAdmin } = useAuth();
  const [tab, setTab] = useState('login');
  const [form, setForm] = useState({
    usernameOrEmail: '',
    username: '',
    email: '',
    password: '',
    bootstrapToken: ''
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const update = (field) => (event) => setForm(prev => ({ ...prev, [field]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (tab === 'login') {
        await login(form.usernameOrEmail, form.password);
      } else if (tab === 'register') {
        await register(form.username, form.email, form.password);
      } else {
        await bootstrapAdmin(form.bootstrapToken, form.username, form.email, form.password);
        setNotice('Administrator provisioned. Sign in with the new admin account.');
        setTab('login');
        setForm(prev => ({ ...prev, usernameOrEmail: prev.username, password: '', bootstrapToken: '' }));
      }
    } catch (err) {
      const described = describeApiError(err);
      setError(described.detail + (described.status ? ` (HTTP ${described.status})` : ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-slate-800 flex items-center gap-3">
          <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-indigo-400">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-wide">CausalOTel</h1>
            <p className="text-xs text-slate-400">Root cause observability console</p>
          </div>
        </div>

        <div className="grid grid-cols-3 border-b border-slate-800">
          {TABS.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => { setTab(item.id); setError(null); setNotice(null); }}
                className={`py-3 text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
                  tab === item.id
                    ? 'bg-indigo-600/20 text-indigo-300 border-b-2 border-indigo-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          {notice && (
            <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-xs flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{notice}</span>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {tab === 'login' && (
            <>
              <label className="block text-xs text-slate-400">
                Username or email
                <input
                  required
                  value={form.usernameOrEmail}
                  onChange={update('usernameOrEmail')}
                  className="mt-1 w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </label>
              <label className="block text-xs text-slate-400">
                Password
                <input
                  required
                  type="password"
                  value={form.password}
                  onChange={update('password')}
                  className="mt-1 w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </label>
            </>
          )}

          {tab === 'register' && (
            <>
              <label className="block text-xs text-slate-400">
                Username
                <input
                  required
                  minLength={3}
                  maxLength={32}
                  value={form.username}
                  onChange={update('username')}
                  className="mt-1 w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </label>
              <label className="block text-xs text-slate-400">
                Email
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={update('email')}
                  className="mt-1 w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </label>
              <label className="block text-xs text-slate-400">
                Password (minimum 8 characters)
                <input
                  required
                  type="password"
                  minLength={8}
                  maxLength={128}
                  value={form.password}
                  onChange={update('password')}
                  className="mt-1 w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </label>
            </>
          )}

          {tab === 'bootstrap' && (
            <>
              <p className="text-xs text-slate-400 leading-relaxed">
                Paste the one-time bootstrap token from
                <span className="font-mono text-slate-300"> %LOCALAPPDATA%\CausalOTel\security\.bootstrap_admin_token</span>.
                This provisions the first administrator; the token is consumed once.
              </p>
              <label className="block text-xs text-slate-400">
                Bootstrap token
                <input
                  required
                  value={form.bootstrapToken}
                  onChange={update('bootstrapToken')}
                  className="mt-1 w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm font-mono text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </label>
              <label className="block text-xs text-slate-400">
                Admin username
                <input
                  required
                  minLength={3}
                  maxLength={32}
                  value={form.username}
                  onChange={update('username')}
                  className="mt-1 w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </label>
              <label className="block text-xs text-slate-400">
                Admin email
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={update('email')}
                  className="mt-1 w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </label>
              <label className="block text-xs text-slate-400">
                Admin password (minimum 8 characters)
                <input
                  required
                  type="password"
                  minLength={8}
                  maxLength={128}
                  value={form.password}
                  onChange={update('password')}
                  className="mt-1 w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </label>
            </>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition"
          >
            {busy ? 'Working...' : tab === 'login' ? 'Sign in' : tab === 'register' ? 'Create account' : 'Provision administrator'}
          </button>
        </form>
      </div>
    </div>
  );
}
