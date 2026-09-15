'use client';

import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import ErrorBanner from '@/components/ErrorBanner';
import { fetchJson } from '@/lib/apiClient';
import { Staff, AvailabilityTemplate, DayOfWeek } from '@/lib/types';
import { DAYS, DAY_SHORT } from '@/lib/shiftUtils';

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

export default function AvailabilityPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [templates, setTemplates] = useState<Record<number, DayTemplate>>({});
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [allTemplates, setAllTemplates] = useState<AvailabilityTemplate[]>([]);
  const [loadError, setLoadError] = useState('');

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
    // Refresh
    const updated = await fetch('/api/availability').then(r => r.json());
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
    return { staff: s, days: tpls.map(t => t.day_of_week) };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Availability</h1>
        <p className="text-sm text-slate-500">Set weekly availability templates for each staff member</p>
      </div>

      {loadError && <ErrorBanner message={loadError} onRetry={load} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Staff selector */}
        <div className="card p-4 space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Select Staff</p>
          {staff.map(s => {
            const hasTemplate = allTemplates.some(t => t.staff_id === s.id && t.available);
            return (
              <button
                key={s.id}
                onClick={() => loadStaffTemplates(s)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors flex items-center justify-between ${selectedStaff?.id === s.id ? 'bg-blue-600 text-white' : 'hover:bg-slate-50 text-slate-700'}`}
              >
                <span className="text-sm font-medium">{s.name}</span>
                {hasTemplate
                  ? <span className={`text-xs ${selectedStaff?.id === s.id ? 'text-blue-100' : 'text-green-600'}`}>✓ Set</span>
                  : <span className={`text-xs ${selectedStaff?.id === s.id ? 'text-blue-200' : 'text-slate-300'}`}>Not set</span>
                }
              </button>
            );
          })}
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

      {/* Full matrix overview */}
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
                  {([0,1,2,3,4,5,6] as DayOfWeek[]).map(d => (
                    <td key={d} className="px-3 py-2 text-center">
                      {days.includes(d)
                        ? <span className="inline-block w-5 h-5 rounded-full bg-green-400" title="Available" />
                        : <span className="inline-block w-5 h-5 rounded-full bg-slate-100" title="Not available" />
                      }
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
