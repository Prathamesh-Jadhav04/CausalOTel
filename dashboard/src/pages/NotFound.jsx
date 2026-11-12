import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass, ArrowLeft } from 'lucide-react';

/**
 * L-03: explicit catch-all page. Unknown dashboard paths render this instead of
 * a blank shell, and the user can return to a known route.
 */
export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center space-y-4 max-w-lg">
        <div className="mx-auto w-14 h-14 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
          <Compass className="w-7 h-7 text-slate-400" />
        </div>
        <h2 className="text-2xl font-bold text-slate-100">Page not found</h2>
        <p className="text-slate-400">
          This dashboard route does not exist. It may be an outdated link or a mistyped URL.
        </p>
        <button
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to overview
        </button>
      </div>
    </div>
  );
}
