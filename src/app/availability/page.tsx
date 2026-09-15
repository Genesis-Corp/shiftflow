'use client';

import { useEffect, useMemo, useState } from 'react';
import { Save, List, GanttChartSquare } from 'lucide-react';
import ErrorBanner from '@/components/ErrorBanner';
import { fetchJson } from '@/lib/apiClient';
import { Staff, AvailabilityTemplate, DayOfWeek } from '@/lib/types';
import {
  DAYS, DAY_SHORT, TIMELINE_START_HOUR, TIMELINE_END_HOUR,
  timelineBarPosition, formatHour12,
} from '@/lib/shiftUtils';

const DEFAULT_SLOTS = [
  { start_time: '06:00', end_time: '14:00' },
  { start_time: '09:00', end_time: '17:00' },
  { start_time: '14:00', end_time: '22:00' },
];

interface DayTemplate {
  available: boolean;
  start_time: string;
  end_time: string;
}

/** "09:00" -> "9am", "17:30" -> "5:30pm" — compact, for cells and bar labels. */
function formatTimeShort(t: string): string {
  const [hStr, mStr] = t.split(':');
  const h = Number(hStr);
  const period = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return mStr === '00' ? `${h12}${period}` : `${h12}:${mStr}${period}`;
}

export default function AvailabilityPage() {
  const [view, setView] = useState<'editor' | 'timeline'>('editor');
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [templates, setTemplates] = useState<Record<number, DayTemplate>>({});
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [allTemplates, setAllTemplates] = useState<AvailabilityTemplate[]>([]);
  const [loadError, setLoadError] = useState('');
  const [timelineDay, setTimelineDay] = useState<DayOfWeek>(new Date().getDay() as DayOfWeek);

  async function load() {
    try {
      const [staffData, templateData] = await Promise.all([
        fetchJson<Staff[]>('/api/staff'),
        fetchJson<AvailabilityTemplate[]>('/api/availability'),
      ]);
      setStaff(staffData.filter(s => s.active));
      setAllTemplates(templateData);
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load availability data');
    }
  }

  useEffect(() => { load(); }, []);

  function loadStaffTemplates(s: Staff) {
    setSelectedStaff(s);
    const existing = allTemplates.filter(t => t.staff_id === s.id);
    const map: Record<number, DayTemplate> = {};
    for (let i = 0; i < 7; i++) {
      const t = existing.find(e => e.day_of_week === i);
      map[i] = t
        ? { available: t.available, start_time: t.start_time, end_time: t.end_time }
        : { available: false, start_time: '09:00', end_time: '17:00' };
    }
    setTemplates(map);
    setSaved(false);
  }

  async function save() {
    if (!selectedStaff) return;
    setLoading(true);
    const rows = Object.entries(templates).map(([day, t]) => ({
      day_of_week: Number(day), ...t,
    }));
    await fetch('/api/availability', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staff_id: selectedStaff.id, templates: rows.filter(r => r.available) }),
    });
    const updated = await fetchJson<AvailabilityTemplate[]>('/api/availability');
    setAllTemplates(updated);
    setLoading(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function applyPreset(preset: { start_time: string; end_time: string }) {
    setTemplates(t => {
      const next = { ...t };
      for (let i = 1; i <= 5; i++) { // Mon–Fri
        next[i] = { ...next[i], ...preset, available: true };
      }
      return next;
    });
  }

  // Matrix: all active staff × days (read-only overview)
  const staffWithAvail = staff.map(s => {
    const tpls = allTemplates.filter(t => t.staff_id === s.id && t.available);
    return { staff: s, days: tpls };
  });

  // Timeline: everyone's template (if any) for the selected day.
  const timelineHours = useMemo(
    () => Array.from(
      { length: TIMELINE_END_HOUR - TIMELINE_START_HOUR },
      (_, i) => TIMELINE_START_HOUR + i
    ),
    []
  );
  const timelineRows = staff.map(s => ({
    staff: s,
    template: allTemplates.find(t => t.staff_id === s.id && t.day_of_week === timelineDay && t.available) ?? null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Availability</h1>
          <p className="text-sm text-slate-500">Set weekly availability templates for each staff member</p>
        </div>

        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
          <button
            onClick={() => setView('editor')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              view === 'editor' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <List size={14} /> Editor
          </button>
          <button
            onClick={() => setView('timeline')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              view === 'timeline' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <GanttChartSquare size={14} /> Daily Timeline
          </button>
        </div>
      </div>

      {loadError && <ErrorBanner message={loadError} onRetry={load} />}

      {view === 'editor' ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Staff selector — compact grid, name + a set/not-set dot only.
                The times used to be spelled out here too, which pushed the
                list a long way down the page for no real benefit: they're
                already visible in full once a name is selected. */}
            <div className="card p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Select Staff</p>
              <div className="grid grid-cols-3 gap-1.5">
                {staff.map(s => {
                  const hasTemplate = allTemplates.some(t => t.staff_id === s.id && t.available);
                  const selected = selectedStaff?.id === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => loadStaffTemplates(s)}
                      title={s.name}
                      className={`flex items-center gap-1.5 px-2 py-2 rounded-lg text-left transition-colors ${
                        selected ? 'bg-blue-600 text-white' : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          hasTemplate ? (selected ? 'bg-blue-200' : 'bg-green-500') : (selected ? 'bg-blue-300' : 'bg-slate-300')
                        }`}
                      />
                      <span className="text-sm font-medium truncate">{s.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Editor */}
            <div className="lg:col-span-2">
              {!selectedStaff ? (
                <div className="card p-10 text-center text-slate-400">Select a staff member to edit their availability</div>
              ) : (
                <div className="card p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-slate-800">{selectedStaff.name}&apos;s Weekly Availability</h2>
                    <div className="flex gap-2">
                      <span className="text-xs text-slate-400">Quick fill:</span>
                      {DEFAULT_SLOTS.map(s => (
                        <button key={s.start_time} onClick={() => applyPreset(s)} className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600">
                          {s.start_time}–{s.end_time}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {DAYS.map((day, i) => {
                      const t = templates[i] ?? { available: false, start_time: '09:00', end_time: '17:00' };
                      return (
                        <div key={i} className={`rounded-lg border p-3 transition-colors ${t.available ? 'border-blue-200 bg-blue-50/40' : 'border-slate-200'}`}>
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-2 w-28 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={t.available}
                                onChange={e => setTemplates(prev => ({ ...prev, [i]: { ...t, available: e.target.checked } }))}
                                className="w-4 h-4 accent-blue-600"
                              />
                              <span className={`text-sm font-medium ${t.available ? 'text-blue-800' : 'text-slate-400'}`}>{day}</span>
                            </label>
                            {t.available && (
                              <div className="flex items-center gap-2">
                                <input type="time" className="input w-auto py-1 text-sm" value={t.start_time}
                                  onChange={e => setTemplates(prev => ({ ...prev, [i]: { ...t, start_time: e.target.value } }))} />
                                <span className="text-slate-400 text-sm">to</span>
                                <input type="time" className="input w-auto py-1 text-sm" value={t.end_time}
                                  onChange={e => setTemplates(prev => ({ ...prev, [i]: { ...t, end_time: e.target.value } }))} />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <button onClick={save} disabled={loading} className="btn-primary w-full">
                    <Save size={15} /> {saved ? 'Saved!' : loading ? 'Saving...' : 'Save Availability'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Full matrix overview — times, not just a dot */}
          <div className="card p-4">
            <h2 className="font-semibold text-slate-800 mb-3">Availability Matrix Overview</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left px-3 py-2 text-slate-500 font-semibold w-36">Staff</th>
                    {DAY_SHORT.map(d => <th key={d} className="px-3 py-2 text-slate-500 font-semibold text-center">{d}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {staffWithAvail.map(({ staff: s, days }) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-700">{s.name}</td>
                      {([0,1,2,3,4,5,6] as DayOfWeek[]).map(d => {
                        const t = days.find(x => x.day_of_week === d);
                        return (
                          <td key={d} className="px-2 py-2 text-center">
                            {t
                              ? (
                                <span
                                  className="inline-block rounded bg-green-100 text-green-800 px-1.5 py-0.5 whitespace-nowrap"
                                  title={`${formatTimeShort(t.start_time)}–${formatTimeShort(t.end_time)}`}
                                >
                                  {formatTimeShort(t.start_time)}–{formatTimeShort(t.end_time)}
                                </span>
                              )
                              : <span className="inline-block w-5 h-5 rounded-full bg-slate-100" title="Not available" />
                            }
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="card p-4">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <h2 className="font-semibold text-slate-800">Who&apos;s available — {DAYS[timelineDay]}</h2>
            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
              {DAY_SHORT.map((d, i) => (
                <button
                  key={d}
                  onClick={() => setTimelineDay(i as DayOfWeek)}
                  className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    timelineDay === i
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 hover:bg-slate-50 border-l border-slate-200 first:border-l-0'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {staff.length === 0 ? (
            <p className="text-slate-400 text-center py-8">No active staff.</p>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[900px]">
                {/* Hour header */}
                <div className="flex pl-36">
                  {timelineHours.map(h => (
                    <div key={h} className="flex-1 text-[11px] text-slate-400 font-medium border-l border-slate-100 pl-1">
                      {formatHour12(h)}
                    </div>
                  ))}
                </div>

                {/* One row per active staff member */}
                <div className="mt-1 divide-y divide-slate-100">
                  {timelineRows.map(({ staff: s, template: t }) => {
                    const pos = t ? timelineBarPosition(t.start_time, t.end_time) : null;
                    return (
                      <div key={s.id} className="flex items-center py-2">
                        <div className="w-36 flex-shrink-0 pr-2 text-sm font-medium text-slate-700 truncate">
                          {s.name}
                        </div>
                        <div className="relative flex-1 h-7 rounded bg-slate-50">
                          {/* Hourly gridlines, purely visual */}
                          <div className="absolute inset-0 flex pointer-events-none">
                            {timelineHours.map(h => (
                              <div key={h} className="flex-1 border-l border-slate-100 first:border-l-0" />
                            ))}
                          </div>
                          {pos && (
                            <div
                              title={`${formatTimeShort(t!.start_time)}–${formatTimeShort(t!.end_time)}`}
                              className="absolute inset-y-0.5 rounded bg-blue-500 flex items-center px-1.5 overflow-hidden"
                              style={{ left: `${pos.leftPct}%`, width: `${pos.widthPct}%` }}
                            >
                              <span className="text-[11px] text-white font-medium whitespace-nowrap">
                                {formatTimeShort(t!.start_time)}–{formatTimeShort(t!.end_time)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
