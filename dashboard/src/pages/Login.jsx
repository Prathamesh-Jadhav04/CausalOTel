import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Eye,
  EyeOff,
  GitFork,
  KeyRound,
  LogIn,
  ShieldCheck,
  UserPlus,
  Zap
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';
import { describeApiError } from '../lib/contracts.js';
import { BrandLockup, BrandMark, Button, cn, ThemeToggle } from '../components/ui.jsx';

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

const inputClass = 'mt-1.5 h-11 w-full rounded-lg border border-white/[0.09] bg-surface-1/70 px-3.5 text-sm text-ink outline-none transition placeholder:text-ink-tertiary focus:border-signal-400/55 focus:bg-surface-2/80 focus:ring-4 focus:ring-signal-500/10';

function PasswordField({ label, value, onChange, show, onToggle, minLength, maxLength, autoComplete }) {
  return (
    <label className="block text-[11px] font-medium uppercase tracking-[0.045em] text-ink-subtle">
      {label}
      <span className="relative block">
        <input
          required
          type={show ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          minLength={minLength}
          maxLength={maxLength}
          autoComplete={autoComplete}
          className={cn(inputClass, 'pr-12')}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-white/38 transition hover:bg-white/[0.08] hover:text-white/80"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </span>
    </label>
  );
}

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
  const [showPassword, setShowPassword] = useState(false);

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

      <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>

      <div className="relative z-10 grid w-full max-w-5xl gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-12">
        <div className="hidden lg:block">
          <div className="flex items-center gap-3">
            <BrandMark size="lg" />
            <div>
              <p className="text-lg font-semibold tracking-[-0.03em] text-white">CausalOTel</p>
              <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.045em] text-ink-subtle">Root cause observability</p>
            </div>
          </div>

          <h1 className="mt-8 text-balance text-5xl font-semibold leading-[1.08] tracking-[-0.03em] text-ink lg:text-[56px] lg:leading-[1.1] lg:tracking-[-0.032em]">
            See the signal
            <span className="block text-ink-tertiary">before the noise.</span>
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-subtle">
            Correlate live traces, Prometheus metrics, and service health into a single causal view of your local stack.
          </p>

          <div className="mt-8 grid max-w-lg grid-cols-2 gap-2.5">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <div key={feature.label} className="glass-panel rounded-xl p-3.5">
                  <span className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-signal-300">
                    <Icon className="h-4 w-4" />
                  </span>
                  <p className="mt-2.5 text-[11px] font-semibold text-ink-muted">{feature.label}</p>
                  <p className="mt-0.5 text-[9px] leading-relaxed text-ink-tertiary">{feature.hint}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-7 flex items-center gap-2 text-[10px] text-ink-tertiary">
            <span className="live-dot" />
            Local-first observability · no cloud dependency
          </div>
        </div>

        <div className="glass-panel-strong rounded-3xl p-1.5 shadow-[var(--panel-shadow)]">
          <div className="rounded-2xl border border-white/[0.055] bg-canvas/75 p-4 sm:p-6">
            <div className="lg:hidden">
              <BrandLockup />
            </div>

            <div className="mt-5 lg:mt-0">
              <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.045em] text-ink-subtle">
                <ShieldCheck className="h-3 w-3 text-signal-400" />
                Secure console
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-ink">
                {tab === 'login' ? 'Welcome back' : tab === 'register' ? 'Create your account' : 'Provision administrator'}
              </h2>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-subtle">
                {tab === 'login'
                  ? 'Sign in to the local observability stack.'
                  : tab === 'register'
                    ? 'Register a viewer account for this local stack.'
                    : 'Consume the one-time bootstrap token to create the first admin.'}
              </p>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-1 rounded-lg border border-hairline bg-inset p-1">
              {TABS.map((item) => {
                const Icon = item.icon;
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { setTab(item.id); setError(null); setNotice(null); setShowPassword(false); }}
                    aria-pressed={active}
                    className={cn(
                      'flex min-h-10 items-center justify-center gap-1.5 rounded-md px-1.5 text-[11px] font-medium transition',
                      active
                        ? 'bg-white/[0.1] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]'
                        : 'text-ink-subtle hover:bg-white/[0.05] hover:text-ink-muted'
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
                <div className="flex items-start gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.07] p-3 text-[11px] leading-relaxed text-emerald-200">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{notice}</span>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-400/[0.07] p-3 text-[11px] leading-relaxed text-rose-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {tab === 'login' && (
                <>
                  <label className="block text-[11px] font-medium uppercase tracking-[0.045em] text-ink-subtle">
                    Username or email
                    <input
                      required
                      value={form.usernameOrEmail}
                      onChange={update('usernameOrEmail')}
                      className={inputClass}
                    />
                  </label>
                  <PasswordField
                    label="Password"
                    value={form.password}
                    onChange={update('password')}
                    show={showPassword}
                    onToggle={() => setShowPassword(v => !v)}
                    autoComplete="current-password"
                  />
                </>
              )}

              {tab === 'register' && (
                <>
                  <label className="block text-[11px] font-medium uppercase tracking-[0.045em] text-ink-subtle">
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
                  <label className="block text-[11px] font-medium uppercase tracking-[0.045em] text-ink-subtle">
                    Email
                    <input
                      required
                      type="email"
                      value={form.email}
                      onChange={update('email')}
                      className={inputClass}
                    />
                  </label>
                  <PasswordField
                    label="Password (minimum 8 characters)"
                    value={form.password}
                    onChange={update('password')}
                    show={showPassword}
                    onToggle={() => setShowPassword(v => !v)}
                    minLength={8}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </>
              )}

              {tab === 'bootstrap' && (
                <>
                  <p className="rounded-lg border border-hairline bg-inset p-3 text-[10px] leading-relaxed text-ink-subtle">
                    Paste the one-time bootstrap token from
                    <span className="break-all font-mono text-ink-muted"> %LOCALAPPDATA%\CausalOTel\security\.bootstrap_admin_token</span>.
                    This provisions the first administrator; the token is consumed once.
                  </p>
                  <label className="block text-[11px] font-medium uppercase tracking-[0.045em] text-ink-subtle">
                    Bootstrap token
                    <input
                      required
                      value={form.bootstrapToken}
                      onChange={update('bootstrapToken')}
                      className={cn(inputClass, 'font-mono')}
                    />
                  </label>
                  <label className="block text-[11px] font-medium uppercase tracking-[0.045em] text-ink-subtle">
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
                  <label className="block text-[11px] font-medium uppercase tracking-[0.045em] text-ink-subtle">
                    Admin email
                    <input
                      required
                      type="email"
                      value={form.email}
                      onChange={update('email')}
                      className={inputClass}
                    />
                  </label>
                  <PasswordField
                    label="Admin password (minimum 8 characters)"
                    value={form.password}
                    onChange={update('password')}
                    show={showPassword}
                    onToggle={() => setShowPassword(v => !v)}
                    minLength={8}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </>
              )}

              <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
                {busy ? 'Working' : tab === 'login' ? 'Sign in' : tab === 'register' ? 'Create account' : 'Provision administrator'}
              </Button>
            </form>

            <p className="mt-4 text-center text-[9px] leading-relaxed text-ink-tertiary">
              CausalOTel local console · tokens are verified by every downstream service
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
