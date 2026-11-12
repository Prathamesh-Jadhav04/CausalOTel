import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  GitFork,
  KeyRound,
  LogIn,
  ShieldCheck,
  UserPlus,
  Zap
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';
import { describeApiError } from '../lib/contracts.js';
import { BrandLockup, BrandMark, Button, cn } from '../components/ui.jsx';

const TABS = [
  { id: 'login', label: 'Sign in', icon: LogIn },
  { id: 'register', label: 'Register', icon: UserPlus },
  { id: 'bootstrap', label: 'Admin setup', icon: KeyRound }
];

const FEATURES = [
  { icon: GitFork, label: 'Trace-derived topology', hint: 'Live Tempo dependency graph' },
  { icon: BarChart3, label: 'Prometheus signals', hint: 'Real rates and latency quantiles' },
  { icon: Zap, label: 'Bounded chaos', hint: 'Admin-only fault injection' },
  { icon: Activity, label: 'Causal evidence', hint: 'Recorded RCA and remediation' }
];

const inputClass = 'mt-1.5 h-11 w-full rounded-xl border border-white/[0.09] bg-black/30 px-3.5 text-[13px] text-white/90 outline-none transition placeholder:text-white/28 focus:border-signal-400/55 focus:bg-black/40 focus:ring-4 focus:ring-signal-500/10';

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
    <div className="app-shell relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-8 text-white sm:px-6 lg:py-12">
      <div className="ambient-glow" aria-hidden="true" />

      <div className="relative z-10 grid w-full max-w-5xl gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-12">
        <div className="hidden lg:block">
          <div className="flex items-center gap-3">
            <BrandMark size="lg" />
            <div>
              <p className="text-lg font-semibold tracking-[-0.03em] text-white">CausalOTel</p>
              <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-white/40">Root cause observability</p>
            </div>
          </div>

          <h1 className="mt-8 text-balance text-5xl font-semibold leading-[1.03] tracking-[-0.05em] text-white">
            See the signal
            <span className="block text-white/40">before the noise.</span>
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/50">
            Correlate live traces, Prometheus metrics, and service health into a single causal view of your local stack.
          </p>

          <div className="mt-8 grid max-w-lg grid-cols-2 gap-2.5">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <div key={feature.label} className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3.5">
                  <span className="grid h-8 w-8 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-white/56">
                    <Icon className="h-4 w-4" />
                  </span>
                  <p className="mt-2.5 text-[11px] font-semibold text-white/74">{feature.label}</p>
                  <p className="mt-0.5 text-[9px] leading-relaxed text-white/36">{feature.hint}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-7 flex items-center gap-2 text-[10px] text-white/32">
            <span className="live-dot" />
            Local-first observability · no cloud dependency
          </div>
        </div>

        <div className="glass-panel-strong rounded-[30px] p-1.5 shadow-[0_40px_100px_-30px_rgba(0,0,0,0.95)]">
          <div className="rounded-[26px] border border-white/[0.055] bg-[#0b0b0e]/80 p-4 sm:p-6">
            <div className="lg:hidden">
              <BrandLockup />
            </div>

            <div className="mt-5 lg:mt-0">
              <p className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.22em] text-white/40">
                <ShieldCheck className="h-3 w-3 text-signal-400" />
                Secure console
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-white">
                {tab === 'login' ? 'Welcome back' : tab === 'register' ? 'Create your account' : 'Provision administrator'}
              </h2>
              <p className="mt-1.5 text-[11px] leading-relaxed text-white/46">
                {tab === 'login'
                  ? 'Sign in to the local observability stack.'
                  : tab === 'register'
                    ? 'Register a viewer account for this local stack.'
                    : 'Consume the one-time bootstrap token to create the first admin.'}
              </p>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-1 rounded-2xl border border-white/[0.07] bg-black/25 p-1">
              {TABS.map((item) => {
                const Icon = item.icon;
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { setTab(item.id); setError(null); setNotice(null); }}
                    aria-pressed={active}
                    className={cn(
                      'flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-1.5 text-[10px] font-semibold transition sm:text-[11px]',
                      active
                        ? 'bg-white text-ink-950 shadow-[0_8px_22px_-10px_rgba(255,255,255,0.7)]'
                        : 'text-white/50 hover:bg-white/[0.05] hover:text-white/78'
                    )}
                  >
                    <Icon className="hidden h-3.5 w-3.5 sm:block" />
                    {item.label}
                  </button>
                );
              })}
            </div>

            <form onSubmit={submit} className="mt-5 space-y-3.5">
              {notice && (
                <div className="flex items-start gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.07] p-3 text-[11px] leading-relaxed text-emerald-200">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{notice}</span>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-400/[0.07] p-3 text-[11px] leading-relaxed text-rose-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {tab === 'login' && (
                <>
                  <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-white/46">
                    Username or email
                    <input
                      required
                      value={form.usernameOrEmail}
                      onChange={update('usernameOrEmail')}
                      className={inputClass}
                    />
                  </label>
                  <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-white/46">
                    Password
                    <input
                      required
                      type="password"
                      value={form.password}
                      onChange={update('password')}
                      className={inputClass}
                    />
                  </label>
                </>
              )}

              {tab === 'register' && (
                <>
                  <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-white/46">
                    Username
                    <input
                      required
                      minLength={3}
                      maxLength={32}
                      value={form.username}
                      onChange={update('username')}
                      className={inputClass}
                    />
                  </label>
                  <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-white/46">
                    Email
                    <input
                      required
                      type="email"
                      value={form.email}
                      onChange={update('email')}
                      className={inputClass}
                    />
                  </label>
                  <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-white/46">
                    Password (minimum 8 characters)
                    <input
                      required
                      type="password"
                      minLength={8}
                      maxLength={128}
                      value={form.password}
                      onChange={update('password')}
                      className={inputClass}
                    />
                  </label>
                </>
              )}

              {tab === 'bootstrap' && (
                <>
                  <p className="rounded-xl border border-white/[0.06] bg-black/20 p-3 text-[10px] leading-relaxed text-white/46">
                    Paste the one-time bootstrap token from
                    <span className="break-all font-mono text-white/62"> %LOCALAPPDATA%\CausalOTel\security\.bootstrap_admin_token</span>.
                    This provisions the first administrator; the token is consumed once.
                  </p>
                  <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-white/46">
                    Bootstrap token
                    <input
                      required
                      value={form.bootstrapToken}
                      onChange={update('bootstrapToken')}
                      className={cn(inputClass, 'font-mono')}
                    />
                  </label>
                  <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-white/46">
                    Admin username
                    <input
                      required
                      minLength={3}
                      maxLength={32}
                      value={form.username}
                      onChange={update('username')}
                      className={inputClass}
                    />
                  </label>
                  <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-white/46">
                    Admin email
                    <input
                      required
                      type="email"
                      value={form.email}
                      onChange={update('email')}
                      className={inputClass}
                    />
                  </label>
                  <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-white/46">
                    Admin password (minimum 8 characters)
                    <input
                      required
                      type="password"
                      minLength={8}
                      maxLength={128}
                      value={form.password}
                      onChange={update('password')}
                      className={inputClass}
                    />
                  </label>
                </>
              )}

              <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
                {busy ? 'Working' : tab === 'login' ? 'Sign in' : tab === 'register' ? 'Create account' : 'Provision administrator'}
              </Button>
            </form>

            <p className="mt-4 text-center text-[9px] leading-relaxed text-white/28">
              CausalOTel local console · tokens are verified by every downstream service
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
