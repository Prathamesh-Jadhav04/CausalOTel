import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Compass } from 'lucide-react';
import { Button, GlassCard } from '../components/ui.jsx';

/**
 * L-03: explicit catch-all page. Unknown dashboard paths render this instead of
 * a blank shell, and the user can return to a known route.
 */
export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <GlassCard className="relative w-full max-w-lg overflow-hidden px-6 py-12 text-center sm:px-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_120%_at_50%_0%,rgba(94,105,209,0.14),transparent_60%)]" />
        <div className="relative">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-white/54">
            <Compass className="h-6 w-6" />
          </div>
          <p className="mt-5 text-[9px] font-semibold uppercase tracking-[0.22em] text-white/40">Route not found</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-white">Page not found</h1>
          <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-white/46">
            This dashboard route does not exist. It may be an outdated link or a mistyped URL.
          </p>
          <Button variant="primary" className="mt-6" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4" />
            Back to overview
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
