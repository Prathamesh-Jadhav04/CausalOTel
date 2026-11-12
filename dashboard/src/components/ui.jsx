import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Info,
  Loader2,
  Search,
  ShieldCheck,
  X
} from 'lucide-react';

export function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}

const MARK_SIZES = {
  sm: 'h-9 w-9 rounded-xl',
  md: 'h-10 w-10 rounded-[14px]',
  lg: 'h-14 w-14 rounded-[20px]'
};

const MARK_ICON_SIZES = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-7 w-7'
};

export function BrandMark({ size = 'md', className }) {
  return (
    <span
      className={cn(
        'relative grid shrink-0 place-items-center overflow-hidden bg-gradient-to-br from-signal-400 via-signal-500 to-signal-700 text-white ring-1 ring-white/20',
        'shadow-[0_12px_32px_-10px_rgba(255,45,85,0.85)]',
        MARK_SIZES[size] || MARK_SIZES.md,
        className
      )}
      aria-hidden="true"
    >
      <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(255,255,255,0.5),transparent_46%)]" />
      <ShieldCheck className={cn('relative', MARK_ICON_SIZES[size] || MARK_ICON_SIZES.md)} strokeWidth={2.2} />
    </span>
  );
}

export function BrandLockup({ size = 'md', subtitle = true, className, subtitleClassName }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      <BrandMark size={size} />
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold tracking-[-0.02em] text-white">CausalOTel</p>
        {subtitle && (
          <p className={cn(
            'mt-0.5 truncate text-[9px] font-semibold uppercase tracking-[0.18em] text-white/44',
            subtitleClassName
          )}>
            Root cause observability
          </p>
        )}
      </div>
    </div>
  );
}

const BADGE_TONES = {
  neutral: 'border-white/10 bg-white/[0.055] text-white/66',
  signal: 'border-signal-400/25 bg-signal-500/10 text-signal-300',
  emerald: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
  amber: 'border-amber-400/20 bg-amber-400/10 text-amber-200',
  rose: 'border-rose-400/20 bg-rose-400/10 text-rose-200',
  sky: 'border-sky-400/20 bg-sky-400/10 text-sky-200',
  violet: 'border-violet-400/20 bg-violet-400/10 text-violet-200'
};

const DOT_TONES = {
  neutral: 'bg-white/35',
  signal: 'bg-signal-400 shadow-[0_0_10px_rgba(255,45,85,0.75)]',
  emerald: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.55)]',
  amber: 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.5)]',
  rose: 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.55)]',
  sky: 'bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.5)]',
  violet: 'bg-violet-400 shadow-[0_0_10px_rgba(167,139,250,0.5)]'
};

export function Badge({ tone = 'neutral', dot = false, className, children }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold leading-none tracking-[0.06em]',
        BADGE_TONES[tone] || BADGE_TONES.neutral,
        className
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', DOT_TONES[tone] || DOT_TONES.neutral)} />}
      {children}
    </span>
  );
}

export function statusTone(status) {
  const value = String(status || '').toUpperCase();
  if (['UP', 'HEALTHY', 'RESOLVED', 'OK', 'SUCCESS', 'NORMAL', 'STATUS_CODE_OK', 'AVAILABLE'].includes(value)) {
    return 'emerald';
  }
  if (['DOWN', 'DEGRADED', 'HIGH', 'WARNING', 'NOT BUILT', 'PARTIAL'].includes(value)) {
    return 'amber';
  }
  if (['ACTIVE', 'CRITICAL', 'ERROR', 'FAILED', 'UNREACHABLE', 'SEVERE'].includes(value)) {
    return 'rose';
  }
  if (['MEDIUM', 'CHECKING', 'INFO'].includes(value)) {
    return 'sky';
  }
  return 'neutral';
}

export function StatusBadge({ status, label, className, dot = true }) {
  const tone = statusTone(status);
  return (
    <Badge tone={tone} dot={dot} className={className}>
      {label || status || 'UNKNOWN'}
    </Badge>
  );
}

const BUTTON_VARIANTS = {
  primary:
    'border border-signal-300/20 bg-gradient-to-b from-signal-400 to-signal-600 text-white shadow-[0_12px_30px_-12px_rgba(255,45,85,0.9)] hover:from-signal-300 hover:to-signal-500',
  secondary:
    'border border-white/10 bg-white/[0.06] text-white/78 hover:border-white/20 hover:bg-white/[0.1] hover:text-white',
  ghost:
    'border border-transparent text-white/58 hover:bg-white/[0.06] hover:text-white',
  danger:
    'border border-rose-400/25 bg-rose-500/10 text-rose-200 hover:border-rose-400/40 hover:bg-rose-500/18',
  amber:
    'border border-amber-400/20 bg-amber-400/10 text-amber-200 hover:bg-amber-400/15',
  white:
    'border border-white bg-white text-ink-950 shadow-[0_10px_28px_-12px_rgba(255,255,255,0.6)] hover:bg-white/90'
};

const BUTTON_SIZES = {
  sm: 'h-9 rounded-xl px-3 text-xs',
  md: 'h-10 rounded-xl px-4 text-[13px]',
  lg: 'h-12 rounded-2xl px-5 text-sm'
};

export function buttonStyles({ variant = 'secondary', size = 'md', className } = {}) {
  return cn(
    'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold transition duration-200 disabled:pointer-events-none disabled:opacity-45',
    BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.secondary,
    BUTTON_SIZES[size] || BUTTON_SIZES.md,
    className
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  loading = false,
  disabled,
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={buttonStyles({ variant, size, className })}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function IconButton({ label, variant = 'secondary', className, children, type = 'button', ...props }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-grid h-10 w-10 shrink-0 place-items-center rounded-full border transition duration-200 disabled:pointer-events-none disabled:opacity-45',
        BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.secondary,
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function GlassCard({ as: Component = 'div', interactive = false, className, children, ...props }) {
  return (
    <Component
      className={cn(
        'glass-panel rounded-[24px]',
        interactive && 'transition duration-300 hover:-translate-y-0.5 hover:border-white/15 hover:bg-white/[0.055]',
        className
      )}
      {...props}
    >
      {children}
    </Component>
  );
}

export function PageHeader({ eyebrow, title, description, actions, meta, className, actionsClassName }) {
  return (
    <header className={cn('animate-fade-up', className)}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/44">
              <span className="live-dot is-signal h-1.5 w-1.5 shadow-none" />
              {eyebrow}
            </div>
          )}
          <h1 className="text-balance text-[28px] font-semibold leading-[1.08] tracking-[-0.035em] text-white sm:text-[32px] lg:text-[34px]">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/54 sm:text-sm">
              {description}
            </p>
          )}
          {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {actions && (
          <div className={cn('flex flex-wrap items-center gap-2', actionsClassName)}>{actions}</div>
        )}
      </div>
    </header>
  );
}

export function CardHeader({ icon: Icon, eyebrow, title, description, action, className }) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.05] text-white/64">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">{eyebrow}</p>
          )}
          <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-white/92 sm:text-sm">{title}</h2>
          {description && <p className="mt-1 text-[11px] leading-relaxed text-white/48">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

const STAT_TONES = {
  neutral: 'border-white/[0.08] bg-white/[0.05] text-white/64',
  signal: 'border-signal-400/20 bg-signal-500/10 text-signal-300',
  emerald: 'border-emerald-400/15 bg-emerald-400/[0.08] text-emerald-300',
  amber: 'border-amber-400/15 bg-amber-400/[0.08] text-amber-200',
  rose: 'border-rose-400/15 bg-rose-400/[0.08] text-rose-200',
  sky: 'border-sky-400/15 bg-sky-400/[0.08] text-sky-200'
};

export function StatCard({
  label,
  value,
  suffix,
  hint,
  icon: Icon,
  tone = 'neutral',
  className,
  valueClassName,
  compact = false
}) {
  return (
    <GlassCard className={cn('relative overflow-hidden p-4 sm:p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/44">{label}</p>
        {Icon && (
          <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-xl border', STAT_TONES[tone] || STAT_TONES.neutral)}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className="mt-3 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={cn(
          compact
            ? 'text-[18px] font-semibold leading-tight tracking-[-0.03em] text-white sm:text-[20px]'
            : 'text-[26px] font-semibold leading-none tracking-[-0.04em] text-white sm:text-[28px]',
          valueClassName
        )}>
          {value}
        </span>
        {suffix && <span className="text-[11px] font-medium text-white/50">{suffix}</span>}
      </div>
      {hint && <p className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-white/44">{hint}</p>}
    </GlassCard>
  );
}

export function Chip({ active = false, className, children, type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex min-h-9 select-none items-center justify-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[11px] font-semibold transition duration-200',
        active
          ? 'border-white/20 bg-white text-ink-950 shadow-[0_8px_24px_-10px_rgba(255,255,255,0.65)]'
          : 'border-white/[0.08] bg-white/[0.045] text-white/58 hover:border-white/15 hover:bg-white/[0.08] hover:text-white/86',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function MetaChip({ icon: Icon, children, className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-white/[0.075] bg-white/[0.04] px-2.5 py-1 font-mono text-[10px] text-white/54',
        className
      )}
    >
      {Icon && <Icon className="h-3 w-3 text-white/48" />}
      {children}
    </span>
  );
}

export function SearchField({ value, onChange, placeholder = 'Search...', className, inputClassName, ...props }) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={cn(
          'h-11 w-full rounded-2xl border border-white/[0.08] bg-white/[0.045] pl-10 pr-4 text-[13px] text-white/90 outline-none transition placeholder:text-white/34',
          'focus:border-signal-400/55 focus:bg-white/[0.06] focus:ring-4 focus:ring-signal-500/10',
          inputClassName
        )}
        {...props}
      />
    </div>
  );
}

export function Meter({ value, max = 100, tone = 'signal', className }) {
  const safeMax = Number(max) > 0 ? Number(max) : 1;
  const pct = value === null || value === undefined || !Number.isFinite(Number(value))
    ? 0
    : Math.min(100, Math.max(0, (Number(value) / safeMax) * 100));
  const tones = {
    signal: 'bg-gradient-to-r from-signal-400 to-signal-600',
    emerald: 'bg-gradient-to-r from-emerald-300 to-emerald-500',
    amber: 'bg-gradient-to-r from-amber-300 to-amber-500',
    rose: 'bg-gradient-to-r from-rose-300 to-rose-500',
    sky: 'bg-gradient-to-r from-sky-300 to-sky-500'
  };
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-white/[0.06]', className)}>
      <div className={cn('h-full rounded-full transition-[width] duration-500', tones[tone] || tones.signal)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ProgressRing({
  ratio = 0,
  display,
  caption,
  tone = 'signal',
  size = 96,
  stroke = 8,
  className
}) {
  const gradientId = useId().replace(/:/g, '');
  const safeRatio = Math.min(1, Math.max(0, Number(ratio) || 0));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const palette = {
    signal: ['#ffb3c0', '#ff2d55'],
    emerald: ['#6ee7b7', '#10b981'],
    amber: ['#fcd34d', '#f59e0b'],
    sky: ['#7dd3fc', '#0ea5e9']
  };
  const [from, to] = palette[tone] || palette.signal;

  return (
    <div className={cn('relative grid shrink-0 place-items-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id={`ring-${gradientId}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#ring-${gradientId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - safeRatio)}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[22px] font-semibold leading-none tracking-[-0.04em] text-white">{display}</span>
        {caption && (
          <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/42">{caption}</span>
        )}
      </div>
    </div>
  );
}

export function Notice({ tone = 'success', icon: Icon, children, className }) {
  const tones = {
    success: 'border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-200',
    error: 'border-rose-400/20 bg-rose-400/[0.07] text-rose-200',
    warning: 'border-amber-400/20 bg-amber-400/[0.07] text-amber-200',
    info: 'border-sky-400/20 bg-sky-400/[0.07] text-sky-200'
  };
  const DefaultIcon = tone === 'success' ? CheckCircle2 : tone === 'error' ? AlertTriangle : tone === 'warning' ? AlertTriangle : Info;
  const ResolvedIcon = Icon || DefaultIcon;
  return (
    <div className={cn('flex items-start gap-2.5 rounded-2xl border p-3.5 text-xs leading-relaxed', tones[tone] || tones.info, className)}>
      <ResolvedIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function ErrorBanner({ title, detail, code, children, className }) {
  return (
    <Notice tone="error" className={className}>
      <div className="font-semibold">{title}{code ? ` (${code})` : ''}</div>
      {detail && <div className="mt-1 text-rose-200/72">{detail}</div>}
      {children}
    </Notice>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-white/[0.02] px-6 py-12 text-center',
        className
      )}
    >
      <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-white/44">
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-4 text-sm font-semibold text-white/84">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-white/46">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function LoadingBlock({ label = 'Loading live data...', className }) {
  return (
    <div className={cn('glass-panel flex min-h-36 flex-col items-center justify-center gap-3 rounded-[24px] p-8 text-center', className)}>
      <span className="relative flex h-8 w-8 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-signal-500/15" />
        <span className="h-3 w-3 rounded-full bg-signal-400 shadow-[0_0_18px_rgba(255,45,85,0.8)]" />
      </span>
      <p className="text-xs font-medium text-white/50">{label}</p>
    </div>
  );
}

export function SkeletonRows({ rows = 4, className }) {
  return (
    <div className={cn('space-y-2.5', className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton h-14 rounded-2xl" />
      ))}
    </div>
  );
}

export function BottomSheet({ open, onClose, title, eyebrow, children, footer, className }) {
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKey);
    window.setTimeout(() => closeRef.current?.focus(), 30);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90]">
      <div className="sheet-backdrop absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Panel'}
        className={cn(
          'sheet-panel absolute inset-x-0 bottom-0 mx-auto flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-[30px] border border-white/10 bg-[#121215]/95 shadow-[0_30px_90px_rgba(0,0,0,0.85)] backdrop-blur-2xl',
          'sm:bottom-4 sm:max-w-[560px] sm:rounded-[30px]',
          className
        )}
      >
        <div className="flex justify-center pb-1 pt-3 sm:hidden">
          <span className="h-1.5 w-12 rounded-full bg-white/18" />
        </div>
        <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-2 sm:px-6 sm:pt-5">
          <div className="min-w-0">
            {eyebrow && <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-white/42">{eyebrow}</p>}
            {title && <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-white">{title}</h2>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-white/64 transition hover:bg-white/[0.1] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 sm:px-6">{children}</div>
        {footer && <div className="border-t border-white/[0.08] px-5 py-4 sm:px-6">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mediaQuery = window.matchMedia(query);
    const handleChange = (event) => setMatches(event.matches);
    setMatches(mediaQuery.matches);
    mediaQuery.addEventListener?.('change', handleChange);
    return () => mediaQuery.removeEventListener?.('change', handleChange);
  }, [query]);

  return matches;
}
