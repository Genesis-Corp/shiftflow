'use client';

import { useEffect, useMemo, useState } from 'react';
import { Save, List, GanttChartSquare, Upload, Paperclip, Trash2, CalendarX, Umbrella, Loader2, X, Plus } from 'lucide-react';
import ErrorBanner from '@/components/ErrorBanner';
import { fetchJson } from '@/lib/apiClient';
import { postJson } from '@/lib/api';
import { downscalePhoto } from '@/lib/image';
import { readPdfAsBase64 } from '@/lib/pdf';
import { matchStaffName } from '@/lib/leaveForm';
import { Staff, AvailabilityTemplate, DayOfWeek, StaffLeave, LeaveType } from '@/lib/types';
import {
  DAYS, DAY_SHORT, TIMELINE_START_HOUR, TIMELINE_END_HOUR,
  timelineBarPosition, formatHour12, formatDate, todayStr,
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

/** "Aria Benino" -> "Aria B." — the Select Staff grid is packed 3-wide, so a
 *  full surname reliably means an ellipsis; the first initial is normally
 *  still enough to tell two Arias apart. Full name stays in the tooltip. */
function shortenName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? '';
  const lastInitial = parts[parts.length - 1][0]?.toUpperCase() ?? '';
  return `${parts[0]} ${lastInitial}.`;
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

  // Time off — Request Day Off / Leave forms, each excluding that person
  // from claim races for the date range on file (see @/lib/eligibility).
  const [leaveEntries, setLeaveEntries] = useState<StaffLeave[]>([]);
  const [leaveForm, setLeaveForm] = useState({
    staff_id: '', leave_type: 'day_off' as LeaveType, start_date: '', end_date: '', notes: '',
  });
  const [leaveFile, setLeaveFile] = useState<File | null>(null);
  const [uploadingLeave, setUploadingLeave] = useState(false);
  const [leaveError, setLeaveError] = useState('');

  // A scanned form can name more than one staff member (e.g. a Request Day
  // Off form signed "Eli and Aria") — the primary Staff Member field covers
  // the first, these extra rows cover the rest, each excluded for the same
  // date range once saved.
  const [extraStaff, setExtraStaff] = useState<{ id: string; rawName: string }[]>([]);
  const [scanningLeave, setScanningLeave] = useState(false);
  const [scanNote, setScanNote] = useState('');

  async function load() {
    try {
      const [staffData, templateData, leaveData] = await Promise.all([
        fetchJson<Staff[]>('/api/staff'),
        fetchJson<AvailabilityTemplate[]>('/api/availability'),
        fetchJson<StaffLeave[]>('/api/staff-leave'),
      ]);
      setStaff(staffData.filter(s => s.active));
      setAllTemplates(templateData);
      setLeaveEntries(leaveData);
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load availability data');
    }
  }

  useEffect(() => { load(); }, []);

  async function loadLeave() {
    try {
      setLeaveEntries(await fetchJson<StaffLeave[]>('/api/staff-leave'));
    } catch {
      // Non-critical for the rest of the page — leave the existing list showing.
    }
  }

  async function submitLeave(e: React.FormEvent) {
    e.preventDefault();
    const staffIds = Array.from(new Set([leaveForm.staff_id, ...extraStaff.map(s => s.id)].filter(Boolean)));
    if (!staffIds.length || !leaveForm.start_date || !leaveForm.end_date) return;
    setLeaveError('');
    setUploadingLeave(true);
    for (const staff_id of staffIds) {
      const fd = new FormData();
      fd.append('staff_id', staff_id);
      fd.append('leave_type', leaveForm.leave_type);
      fd.append('start_date', leaveForm.start_date);
      fd.append('end_date', leaveForm.end_date);
      if (leaveForm.notes.trim()) fd.append('notes', leaveForm.notes.trim());
      if (leaveFile) fd.append('file', leaveFile);
      const res = await fetch('/api/staff-leave', { method: 'POST', body: fd });
      if (!res.ok) {
        setUploadingLeave(false);
        setLeaveError((await res.json().catch(() => ({}))).error ?? 'Could not save that.');
        return;
      }
    }
    setUploadingLeave(false);
    setLeaveForm({ staff_id: '', leave_type: 'day_off', start_date: '', end_date: '', notes: '' });
    setLeaveFile(null);
    setExtraStaff([]);
    setScanNote('');
    await loadLeave();
  }

  async function deleteLeave(id: string) {
    if (!confirm('Delete this record? This removes the exclusion for those dates too.')) return;
    await fetch(`/api/staff-leave/${id}`, { method: 'DELETE' });
    loadLeave();
  }

  /**
   * A photo or PDF of the form gets read automatically the moment it's
   * chosen — any other file type (a phone-scanned doc, etc.) is still
   * attached as-is, just without the auto-fill. Failing to read it never
   * blocks the upload; it only means the fields below stay manual.
   */
  async function handleLeaveFileChange(file: File | null) {
    setLeaveFile(file);
    setScanNote('');
    setExtraStaff([]);
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf';
    if (!isImage && !isPdf) return;

    setScanningLeave(true);
    setLeaveError('');
    try {
      const payload = isPdf
        ? { pdf: await readPdfAsBase64(file) }
        : await downscalePhoto(file).then(({ base64, mediaType }) => ({ image: base64, mediaType }));

      const res = await postJson<{ form_type: string; staff_names: string[]; start_date: string; end_date: string; notes: string }>(
        '/api/scan-leave-form', payload, { timeoutMs: 70_000 }
      );
      if (!res.ok || !res.data) { setScanNote(res.error ?? 'Could not read that form — fill it in by hand.'); return; }

      const { form_type, staff_names, start_date, end_date, notes } = res.data;
      const matches = staff_names.map(rawName => ({ rawName, id: matchStaffName(rawName, staff) ?? '' }));

      setLeaveForm(f => ({
        ...f,
        staff_id: matches[0]?.id || f.staff_id,
        leave_type: form_type === 'request_day_off' ? 'day_off' : form_type === 'farmer_jacks_leave' ? 'leave' : f.leave_type,
        start_date: start_date || f.start_date,
        end_date: end_date || start_date || f.end_date,
        notes: f.notes || notes,
      }));
      setExtraStaff(matches.slice(1));

      const unmatchedCount = matches.filter(m => !m.id).length;
      setScanNote([
        staff_names.length ? `Read from form: ${staff_names.join(', ')}.` : '',
        unmatchedCount
          ? `Could not auto-match ${unmatchedCount === 1 ? 'one of these' : `${unmatchedCount} of these`} to a staff member — check the staff field${matches.length > 1 ? 's' : ''} below.`
          : '',
        start_date ? '' : 'Could not read a date off the form — check it by hand.',
      ].filter(Boolean).join(' '));
    } catch (err) {
      setScanNote(err instanceof Error ? err.message : 'Could not read that form — fill it in by hand.');
    } finally {
      setScanningLeave(false);
    }
  }

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
                      <span className="text-sm font-medium truncate">{shortenName(s.name)}</span>
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
                              : <span className="inline-block w-5 h-5 rounded-full bg-red-100 border border-red-200" title="Not available" />
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

      {/* Time off — Request Day Off / Leave forms. Uploading a photo or PDF
          reads it automatically (staff name(s), dates, leave type) and
          fills the fields below — still editable, and any other file type
          still just gets kept on file. Either way, the date range on file
          is what excludes that person from claim races, same as a birthday
          already does. */}
      <div className="card p-4">
        <h2 className="font-semibold text-slate-800 mb-1 flex items-center gap-2">
          <CalendarX size={16} className="text-slate-400" /> Time Off
        </h2>
        <p className="text-xs text-slate-500 mb-4">
          Upload a Request Day Off or Leave form — a photo or PDF is read automatically, and they&apos;re excluded from claim races for the dates on file.
        </p>

        <form onSubmit={submitLeave} className="mb-4 pb-4 border-b border-slate-100">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
            <div className="lg:col-span-2">
              <label className="label">Staff Member</label>
              <select className="input" required value={leaveForm.staff_id} onChange={e => setLeaveForm(f => ({ ...f, staff_id: e.target.value }))}>
                <option value="">Select staff...</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Type</label>
              <select
                className="input"
                value={leaveForm.leave_type}
                onChange={e => {
                  const leave_type = e.target.value as LeaveType;
                  setLeaveForm(f => ({ ...f, leave_type, end_date: leave_type === 'day_off' ? f.start_date : f.end_date }));
                }}
              >
                <option value="day_off">Day Off</option>
                <option value="leave">Leave</option>
              </select>
            </div>
            <div>
              <label className="label">Start</label>
              <input
                type="date" className="input" required value={leaveForm.start_date}
                onChange={e => {
                  const start_date = e.target.value;
                  setLeaveForm(f => ({
                    ...f, start_date,
                    end_date: f.leave_type === 'day_off' || !f.end_date || f.end_date < start_date ? start_date : f.end_date,
                  }));
                }}
              />
            </div>
            <div>
              <label className="label">End</label>
              <input
                type="date" className="input" required value={leaveForm.end_date} min={leaveForm.start_date || undefined}
                disabled={leaveForm.leave_type === 'day_off'}
                onChange={e => setLeaveForm(f => ({ ...f, end_date: e.target.value }))}
              />
            </div>
            <div className="lg:col-span-2">
              <label className="label">Form (optional, any file)</label>
              <div className="relative">
                <input type="file" className="input py-1.5" onChange={e => handleLeaveFileChange(e.target.files?.[0] ?? null)} />
                {scanningLeave && (
                  <Loader2 size={14} className="animate-spin text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
                )}
              </div>
            </div>
            <div className="lg:col-span-5">
              <label className="label">Notes (optional)</label>
              <input className="input" value={leaveForm.notes} onChange={e => setLeaveForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any context..." />
            </div>
            <button type="submit" disabled={uploadingLeave || scanningLeave} className="btn-primary justify-center">
              <Upload size={14} /> {uploadingLeave ? 'Saving...' : 'Save'}
            </button>
          </div>

          {scanNote && <p className="text-xs text-amber-600 mt-2.5">{scanNote}</p>}

          {extraStaff.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="label">Also on this form</p>
              {extraStaff.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    className="input flex-1"
                    value={row.id}
                    onChange={e => setExtraStaff(rows => rows.map((r, j) => j === i ? { ...r, id: e.target.value } : r))}
                  >
                    <option value="">{row.rawName ? `Select who "${row.rawName}" is...` : 'Select staff...'}</option>
                    {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => setExtraStaff(rows => rows.filter((_, j) => j !== i))}
                    className="btn-ghost p-1.5 text-slate-400 hover:text-red-500"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => setExtraStaff(rows => [...rows, { id: '', rawName: '' }])}
            className="mt-2.5 text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            <Plus size={12} /> Add another staff member on this form
          </button>
        </form>

        {leaveError && <p className="text-sm text-red-600 mb-3">{leaveError}</p>}

        {leaveEntries.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No time off on file.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {leaveEntries.map(l => {
              const today = todayStr();
              const active = l.start_date <= today && l.end_date >= today;
              return (
                <div key={l.id} className="py-2.5 flex items-center gap-3 flex-wrap">
                  <span className={l.leave_type === 'leave' ? 'badge-blue' : 'badge-amber'}>
                    {l.leave_type === 'leave' ? <Umbrella size={11} className="mr-1" /> : <CalendarX size={11} className="mr-1" />}
                    {l.leave_type === 'leave' ? 'Leave' : 'Day Off'}
                  </span>
                  <span className="font-medium text-slate-700">{l.staff?.name ?? '—'}</span>
                  <span className="text-sm text-slate-500">
                    {formatDate(l.start_date)}{l.end_date !== l.start_date && ` – ${formatDate(l.end_date)}`}
                  </span>
                  {active && <span className="badge-green text-xs">Active now</span>}
                  {l.notes && <span className="text-xs text-slate-400">{l.notes}</span>}
                  <div className="ml-auto flex items-center gap-2">
                    {l.file_url && (
                      <a
                        href={l.file_url} target="_blank" rel="noreferrer"
                        className="btn-ghost p-1.5 text-blue-500" title={l.file_name ?? 'View form'}
                      >
                        <Paperclip size={14} />
                      </a>
                    )}
                    <button onClick={() => deleteLeave(l.id)} className="btn-ghost p-1.5 text-red-500 hover:bg-red-50">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
