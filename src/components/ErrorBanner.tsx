'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Shown in place of a data list when it failed to load, instead of silently
 * rendering an empty list — which is indistinguishable from "there is no
 * data" and has caused real confusion (a missing env var on one Vercel
 * environment looked exactly like every department and staff member being
 * deleted).
 */
export default function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-start gap-2.5">
      <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium">Couldn&apos;t load data</p>
        <p className="mt-0.5 text-red-700 break-words">{message}</p>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="btn-ghost text-red-700 hover:bg-red-100 text-xs px-2 py-1 flex-shrink-0">
          <RefreshCw size={13} /> Retry
        </button>
      )}
    </div>
  );
}
