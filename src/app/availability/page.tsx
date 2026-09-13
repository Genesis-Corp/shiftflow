'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Staff, AvailabilityTemplate, DayOfWeek } from '@/lib/types';
import { fetchList } from '@/lib/api';
import ErrorBanner from '@/components/ErrorBanner';
import { DAYS, DAY_SHORT, formatTimeRange12 } from '@/lib/shiftUtils';

/**
 * A read-only view of who can work when.
 *
 * Availability is edited on the Staff page, next to the person it belongs to,
 * and is overwritten wholesale by the next availability sheet — so editing it
 * in two places only invited the two from disagreeing.
 */
export default function AvailabilityPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [templates, setTemplates] = useState<AvailabilityTemplate[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [staffRes, templateRes] = await Promise.all([
      fetchList<Staff>('/api/staff'),
      fetchList<AvailabilityTemplate>('/api/availability'),
    ]);
    setStaff(staffRes.data.filter(s => s.active));
    setTemplates(templateRes.data);
    setLoadError(staffRes.error ?? templateRes.error);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const rows = staff.map(s => {
    const byDay = new Map<number, AvailabilityTemplate>();
    for (const t of templates) {
      if (t.staff_id === s.id && t.available) byDay.set(t.day_of_week, t);
    }
    return { staff: s, byDay };
  });

  function hours(t?: AvailabilityTemplate): string {
    return t ? `${t.start_time.slice(0, 5)}–${t.end_time.slice(0, 5)}` : 'Not available';
  }

  return (
    <div className="space-y-4">
      <ErrorBanner message={loadError} onRetry={load} />

      <div>
        <h1 className="text-2xl font-bold text-slate-900">Availability</h1>
        <p className="text-sm text-slate-500">
          Who can work on each day. Set it on the{' '}
          <Link href="/staff" className="text-blue-600 hover:underline">Staff page</Link>, or by uploading the availability sheet.
        </p>
      </div>

      {loading ? (
        <p className="text-slate-400">Loading...</p>
      ) : (
        <div className="card p-4 space-y-3">
          <h2 className="font-semibold text-slate-800">Availability Matrix Overview</h2>

          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white text-left px-3 py-2 text-slate-500 font-semibold border-b border-r border-slate-200 min-w-[7rem] md:min-w-[9rem]">
                    Staff
                  </th>
                  {DAY_SHORT.map((d, i) => (
                    <th key={d} className="px-2 py-2 text-slate-500 font-semibold text-center border-b border-slate-200 min-w-[5.25rem]" title={DAYS[i]}>
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ staff: s, byDay }) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-700 border-b border-r border-slate-100 whitespace-nowrap">
                      {s.name}
                    </td>
                    {([0, 1, 2, 3, 4, 5, 6] as DayOfWeek[]).map(day => {
                      const t = byDay.get(day);
                      return (
                        <td key={day} className="px-2 py-1.5 text-center border-b border-slate-100" title={`${s.name} — ${DAYS[day]}: ${hours(t)}`}>
                          {t ? (
                            <span className="inline-block rounded border border-green-200 bg-green-50 px-1.5 py-1 text-[11px] font-medium text-green-800 whitespace-nowrap">
                              {formatTimeRange12(t.start_time, t.end_time)}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rows.length === 0 && <p className="text-center text-slate-400 py-8">No active staff yet.</p>}
          <p className="text-xs text-slate-400">
            The hours each person can work. A dash means they are not available that day. Scroll sideways for the rest of the week.
          </p>
        </div>
      )}
    </div>
  );
}
