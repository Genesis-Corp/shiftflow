'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AlertTriangle, X } from 'lucide-react';
import { formatDate } from '@/lib/shiftUtils';
import type { AutomationRun } from '@/lib/automationFlags';

/**
 * What an unattended roster import (currently the Humanforce PDF pipeline)
 * left for a manager to check — an unmatched department, a name not on the
 * staff list, anything it couldn't apply cleanly. The run already applied
 * what it could; this is the "look at this" list, not an approval gate.
 */
export default function AutomationFlagsBanner() {
  const pathname = usePathname();
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [dismissing, setDismissing] = useState<string | null>(null);

  useEffect(() => {
    if (pathname === '/login') return;
    let cancelled = false;
    fetch('/api/automation/flags', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : []))
      .then((data: AutomationRun[]) => { if (!cancelled) setRuns(Array.isArray(data) ? data : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pathname]);

  if (pathname === '/login' || runs.length === 0) return null;

  async function dismiss(id: string) {
    setDismissing(id);
    await fetch('/api/automation/flags', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    setRuns(current => current.filter(r => r.id !== id));
    setDismissing(null);
  }

  async function dismissAll() {
    setDismissing('all');
    await fetch('/api/automation/flags', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    });
    setRuns([]);
    setDismissing(null);
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-4 space-y-2">
      {runs.map(run => (
        <div key={run.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <AlertTriangle size={16} className="text-amber-500 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-amber-900">
                  Automated roster import for {formatDate(run.roster_date)} needs a look
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  {run.shifts_created} shift{run.shifts_created === 1 ? '' : 's'} added across {run.departments_applied} department{run.departments_applied === 1 ? '' : 's'}
                  {run.flags.length > 0 && ` · ${run.flags.length} thing${run.flags.length === 1 ? '' : 's'} to check`}
                </p>
                {run.flags.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {run.flags.map((f, i) => (
                      <li key={i} className="text-xs text-amber-800">
                        {f.department ? <span className="font-medium">{f.department}: </span> : null}
                        {f.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <button
              onClick={() => dismiss(run.id)}
              disabled={dismissing !== null}
              title="Dismiss"
              className="btn-ghost p-1 text-amber-600 shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
      {runs.length > 1 && (
        <div className="flex justify-end">
          <button onClick={dismissAll} disabled={dismissing !== null} className="text-xs text-amber-700 hover:text-amber-900 underline">
            Dismiss all
          </button>
        </div>
      )}
    </div>
  );
}
