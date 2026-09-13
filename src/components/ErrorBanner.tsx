'use client';

import { AlertTriangle, RotateCcw } from 'lucide-react';

/** A failure to reach the database at all, most often a paused Supabase project. */
const UNREACHABLE = /fetch failed|failed to fetch|not connected|paused|ENOTFOUND|ECONNREFUSED|network|timeout/i;

/** Shown when a page cannot load its data, instead of rendering nothing. */
export default function ErrorBanner({ message, onRetry }: { message: string | null; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2">
      <AlertTriangle size={16} className="text-red-500 mt-0.5 shrink-0" />
      <div className="space-y-1">
        {UNREACHABLE.test(message) ? (
          <>
            <p className="text-sm font-medium text-red-800">Could not reach the database</p>
            <p className="text-xs text-red-700">
              Check that the Supabase project is running — free projects pause after a week of inactivity — and that the
              deployment&apos;s Supabase URL and key point at it.
            </p>
            <p className="text-xs text-red-500">{message}</p>
          </>
        ) : (
          <p className="text-sm text-red-700">{message}</p>
        )}
        {onRetry && (
          <button onClick={onRetry} className="btn-secondary mt-1 text-xs py-1">
            <RotateCcw size={12} /> Try again
          </button>
        )}
      </div>
    </div>
  );
}
