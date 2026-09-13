'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

/**
 * Replaces Next.js's bare "Application error: a client-side exception has
 * occurred" with something a supervisor on the shop floor can act on.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);

  return (
    <div className="card p-6 max-w-lg mx-auto mt-10 space-y-3 text-center">
      <AlertTriangle className="mx-auto text-amber-500" size={28} />
      <h1 className="font-semibold text-slate-900">Something went wrong on this page</h1>
      <p className="text-sm text-slate-500">
        {error.message || 'An unexpected error occurred.'}
      </p>
      {error.digest && <p className="text-xs text-slate-400">Reference: {error.digest}</p>}
      <button onClick={reset} className="btn-primary mx-auto"><RotateCcw size={14} /> Try again</button>
    </div>
  );
}
