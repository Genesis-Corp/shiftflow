'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Save, List, GanttChartSquare, Upload, Paperclip, Trash2, CalendarX, Umbrella, Loader2, X, Plus,
  CalendarDays, ChevronLeft, ChevronRight, Pencil, AlertTriangle, Check,
} from 'lucide-react';
import ErrorBanner from '@/components/ErrorBanner';
import StaffName from '@/components/StaffName';
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

/** Every date in a calendar month ('YYYY-MM'), in order. Unlike a week-grid
 *  calendar, the Holidays Gantt runs its bars against a plain date axis, so
 *  there's no need to pad the ends to a whole week the way monthGrid-style
 *  helpers elsewhere do. */
function monthDateList(yearMonth: string): string[] {
  const [y, m] = yearMonth.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  return Array.from(
    { length: daysInMonth },
    (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`
  );
}

function addMonths(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/** Where a leave entry's bar sits against the visible month's date axis,
 *  clipped to the month at either end — a leave period that starts in
 *  August and ends in September still shows a bar running off the left
 *  edge of September's grid, not nothing. Returns null when the entry
 *  doesn't touch this month at all. */
function leaveBarPosition(
  monthDates: string[], startDate: string, endDate: string
): { leftPct: number; widthPct: number } | null {
  const first = monthDates[0];
  const last = monthDates[monthDates.length - 1];
  if (endDate < first || startDate > last) return null;
  const clippedStart = startDate < first ? first : startDate;
  const clippedEnd = endDate > last ? last : endDate;
  const startIdx = monthDates.indexOf(clippedStart);
  const endIdx = monthDates.indexOf(clippedEnd);
  const n = monthDates.length;
  return { leftPct: (startIdx / n) * 100, widthPct: ((endIdx - startIdx + 1) / n) * 100 };
}

interface HolidayRow { staffId: string; name: string; entries: StaffLeave[] }

/** One row per staff member with leave overlapping `monthDates` — shared by
 *  the single-month view and every month panel in the yearly view, so both
 *  scales agree on exactly who counts as "on leave this month". */
function holidayRowsFor(monthDates: string[], leaveEntries: StaffLeave[]): HolidayRow[] {
  const first = monthDates[0];
  const last = monthDates[monthDates.length - 1];
  const byStaff = new Map<string, HolidayRow>();
  for (const l of leaveEntries) {
    if (!l.staff_id || l.end_date < first || l.start_date > last) continue;
    if (!byStaff.has(l.staff_id)) byStaff.set(l.staff_id, { staffId: l.staff_id, name: l.staff?.name ?? 'Unknown', entries: [] });
    byStaff.get(l.staff_id)!.entries.push(l);
  }
  return Array.from(byStaff.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function addYears(yearMonth: string, delta: number): string {
  return addMonths(yearMonth, delta * 12);
}

/** One uploaded form (or a manually-started entry) staged for review before
 *  it becomes a real staff_leave row. `extraStaff` mirrors the same "more
 *  than one name on this form" case the old single-entry flow handled, just
 *  scoped per draft now that there can be several in flight at once. */
interface LeaveDraft {
  key: string;
  file: File | null;
  status: 'reading' | 'ready' | 'error';
  note: string;
  editing: boolean;
  staff_id: string;
  extraStaff: { id: string; rawName: string }[];
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  notes: string;
}

function newDraftKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function blankDraft(): LeaveDraft {
  return {
    key: newDraftKey(), file: null, status: 'ready', note: '', editing: true,
    staff_id: '', extraStaff: [], leave_type: 'day_off', start_date: '', end_date: '', notes: '',
  };
}

function draftStaffIds(d: LeaveDraft): string[] {
  return Array.from(new Set([d.staff_id, ...d.extraStaff.map(s => s.id)].filter(Boolean)));
}

function draftIsValid(d: LeaveDraft): boolean {
  return draftStaffIds(d).length > 0 && !!d.start_date && !!d.end_date;
}

/** One pending upload — collapsed to a summary line once it's read cleanly,
 *  expanded automatically (and by the pencil button any time after) so a
 *  misread is never more than one glance away from the fix. */
function LeaveDraftRow({
  draft, staffList, onUpdate, onRemove,
}: {
  draft: LeaveDraft;
  staffList: Staff[];
  onUpdate: (key: string, patch: Partial<LeaveDraft>) => void;
  onRemove: (key: string) => void;
}) {
  const primaryName = staffList.find(s => s.id === draft.staff_id)?.name;
  const extraNames = draft.extraStaff.map(e => staffList.find(s => s.id === e.id)?.name).filter(Boolean) as string[];
  const namesLabel = [primaryName, ...extraNames].filter(Boolean).join(', ');
  const needsAttention = draft.status === 'error' || !draftIsValid(draft);

  return (
    <div className={`rounded-lg border p-3 ${needsAttention ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        {draft.status === 'reading' ? (
          <Loader2 size={14} className="animate-spin text-slate-400 flex-shrink-0" />
        ) : needsAttention ? (
          <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
        ) : (
          <Check size={14} className="text-green-500 flex-shrink-0" />
        )}

        {draft.file && (
          <span className="text-xs text-slate-400 flex items-center gap-1 truncate max-w-[10rem]">
            <Paperclip size={11} />{draft.file.name}
          </span>
        )}

        <span className={draft.leave_type === 'leave' ? 'badge-blue' : 'badge-amber'}>
          {draft.leave_type === 'leave' ? <Umbrella size={11} className="mr-1" /> : <CalendarX size={11} className="mr-1" />}
          {draft.leave_type === 'leave' ? 'Leave' : 'Day Off'}
        </span>

        <span className="text-sm font-medium text-slate-700 truncate">
          {namesLabel || (draft.status === 'reading' ? 'Reading…' : 'Select staff')}
        </span>

        {draft.start_date && (
          <span className="text-sm text-slate-500">
            {formatDate(draft.start_date)}{draft.end_date !== draft.start_date && ` – ${formatDate(draft.end_date)}`}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => onUpdate(draft.key, { editing: !draft.editing })} className="btn-ghost p-1.5 text-slate-500" title="Edit">
            <Pencil size={13} />
          </button>
          <button type="button" onClick={() => onRemove(draft.key)} className="btn-ghost p-1.5 text-red-500 hover:bg-red-50" title="Remove">
            <X size={14} />
          </button>
        </div>
      </div>

      {draft.note && <p className="text-xs text-amber-700 mt-1.5">{draft.note}</p>}

      {draft.editing && (
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="label">Staff Member</label>
              <select className="input" value={draft.staff_id} onChange={e => onUpdate(draft.key, { staff_id: e.target.value })}>
                <option value="">Select staff...</option>
                {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Type</label>
              <select
                className="input"
                value={draft.leave_type}
                onChange={e => {
                  const leave_type = e.target.value as LeaveType;
                  onUpdate(draft.key, { leave_type, end_date: leave_type === 'day_off' ? draft.start_date : draft.end_date });
                }}
              >
                <option value="day_off">Day Off</option>
                <option value="leave">Leave</option>
              </select>
            </div>
            <div>
              <label className="label">Start</label>
              <input
                type="date" className="input" value={draft.start_date}
                onChange={e => {
                  const start_date = e.target.value;
                  onUpdate(draft.key, {
                    start_date,
                    end_date: draft.leave_type === 'day_off' || !draft.end_date || draft.end_date < start_date ? start_date : draft.end_date,
                  });
                }}
              />
            </div>
            <div>
              <label className="label">End</label>
              <input
                type="date" className="input" value={draft.end_date} min={draft.start_date || undefined}
                disabled={draft.leave_type === 'day_off'}
                onChange={e => onUpdate(draft.key, { end_date: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <input className="input" value={draft.notes} onChange={e => onUpdate(draft.key, { notes: e.target.value })} placeholder="Any context..." />
          </div>

          {draft.extraStaff.length > 0 && (
            <div className="space-y-2">
              <p className="label">Also on this form</p>
              {draft.extraStaff.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    className="input flex-1"
                    value={row.id}
                    onChange={e => onUpdate(draft.key, {
                      extraStaff: draft.extraStaff.map((r, j) => (j === i ? { ...r, id: e.target.value } : r)),
                    })}
                  >
                    <option value="">{row.rawName ? `Select who "${row.rawName}" is...` : 'Select staff...'}</option>
                    {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => onUpdate(draft.key, { extraStaff: draft.extraStaff.filter((_, j) => j !== i) })}
                    className="btn-ghost p-1.5 text-slate-400 hover:text-red-500"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => onUpdate(draft.key, { extraStaff: [...draft.extraStaff, { id: '', rawName: '' }] })}
              className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              <Plus size={12} /> Add another staff member on this form
            </button>
            <button type="button" onClick={() => onUpdate(draft.key, { editing: false })} className="btn-secondary text-xs">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The Gantt's phone equivalent — a 28-31-day bar chart has no good answer
 *  at 375px, so below `sm` this renders instead: one line per leave entry,
 *  flattened out of the same per-staff rows the Gantt draws from, so the two
 *  never disagree about who's actually on leave. */
function HolidayList({ rows }: { rows: HolidayRow[] }) {
  const entries = rows
    .flatMap(r => r.entries.map(e => ({ ...e, staffName: r.name })))
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.staffName.localeCompare(b.staffName));

  return (
    <div className="divide-y divide-slate-100">
      {entries.map(e => (
        <div key={e.id} className="py-2.5 flex items-start gap-3">
          <span className={`mt-0.5 flex-shrink-0 ${e.leave_type === 'leave' ? 'badge-blue' : 'badge-amber'}`}>
            {e.leave_type === 'leave' ? <Umbrella size={11} className="mr-1" /> : <CalendarX size={11} className="mr-1" />}
            {e.leave_type === 'leave' ? 'Leave' : 'Day off'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-700 truncate">
              <StaffName staffId={e.staff_id} name={e.staffName} />
            </p>
            <p className="text-xs text-slate-500">
              {formatDate(e.start_date)}{e.end_date !== e.start_date && ` – ${formatDate(e.end_date)}`}
              {e.notes && ` · ${e.notes}`}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The Gantt itself — a date header plus one row per staff member on leave,
 *  each with a bar per entry spanning the dates it covers. Used both for the
 *  single-month view and, in miniature, for every month panel in the yearly
 *  view, so the two scales are pixel-for-pixel the same drawing logic. */
function MonthHolidayGantt({
  monthDates, rows, compact,
}: {
  monthDates: string[];
  rows: HolidayRow[];
  /** Smaller row height and no bar label — legible stacked twelve at a time. */
  compact?: boolean;
}) {
  // Narrower name column and day columns on a phone: a 31-day axis is wide
  // whatever happens, so the job is to keep the scroll inside this box and
  // as short as it can be rather than pretend it away.
  const labelWidth = compact ? 'w-20 sm:w-24' : 'w-24 sm:w-36';
  const headerPad = compact ? 'pl-20 sm:pl-24' : 'pl-24 sm:pl-36';
  const rowHeight = compact ? 'h-4' : 'h-7';
  const today = todayStr();

  return (
    <div style={{ minWidth: `${(compact ? 5 : 6) + monthDates.length * (compact ? 1 : 1.35)}rem` }}>
      <div className={`flex ${headerPad}`}>
        {monthDates.map(date => {
          const dow = new Date(date + 'T00:00:00').getDay();
          const isToday = date === today;
          return (
            <div
              key={date}
              className={`flex-1 text-center font-medium py-1 border-l border-slate-100 first:border-l-0 ${compact ? 'text-[9px]' : 'text-[11px]'} ${
                dow === 0 || dow === 6 ? 'bg-slate-50 text-slate-400' : 'text-slate-400'
              } ${isToday ? 'text-blue-600 font-bold' : ''}`}
            >
              {Number(date.slice(8, 10))}
            </div>
          );
        })}
      </div>

      <div className="mt-1 divide-y divide-slate-100">
        {rows.map(({ staffId, name, entries }) => (
          <div key={staffId} className="flex items-center py-1">
            <div className={`${labelWidth} flex-shrink-0 pr-2 ${compact ? 'text-xs' : 'text-sm'} font-medium text-slate-700 truncate`}>
              <StaffName staffId={staffId} name={name} />
            </div>
            <div className={`relative flex-1 ${rowHeight} rounded bg-slate-50`}>
              <div className="absolute inset-0 flex pointer-events-none">
                {monthDates.map(date => {
                  const dow = new Date(date + 'T00:00:00').getDay();
                  return (
                    <div
                      key={date}
                      className={`flex-1 border-l border-slate-100 first:border-l-0 ${dow === 0 || dow === 6 ? 'bg-slate-100/60' : ''}`}
                    />
                  );
                })}
              </div>
              {entries.map(l => {
                const pos = leaveBarPosition(monthDates, l.start_date, l.end_date);
                if (!pos) return null;
                return (
                  <div
                    key={l.id}
                    title={`${l.leave_type === 'leave' ? 'Leave' : 'Day off'}: ${formatDate(l.start_date)}${l.end_date !== l.start_date ? ` – ${formatDate(l.end_date)}` : ''}${l.notes ? ` — ${l.notes}` : ''}`}
                    className={`absolute inset-y-0.5 rounded flex items-center overflow-hidden ${compact ? '' : 'px-1.5'} ${
                      l.leave_type === 'leave' ? 'bg-blue-500' : 'bg-amber-500'
                    }`}
                    style={{ left: `${pos.leftPct}%`, width: `${pos.widthPct}%` }}
                  >
                    {!compact && (
                      <span className="text-[11px] text-white font-medium whitespace-nowrap">
                        {l.leave_type === 'leave' ? 'Leave' : 'Day off'}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AvailabilityPage() {
  const [view, setView] = useState<'editor' | 'timeline' | 'holidays'>('editor');
  const [calendarMonth, setCalendarMonth] = useState(todayStr().slice(0, 7));
  const [calendarScale, setCalendarScale] = useState<'month' | 'year'>('month');
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

  // Every uploaded form (and any manually-added entry) lands here first as a
  // draft, never straight into staff_leave — a batch of scans always has at
  // least one misread in it, so nothing saves until it's been eyeballed.
  const [drafts, setDrafts] = useState<LeaveDraft[]>([]);
  const [savingDrafts, setSavingDrafts] = useState(false);
  const [savingProgress, setSavingProgress] = useState<{ done: number; total: number } | null>(null);
  const [draftsError, setDraftsError] = useState('');

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

  function updateDraft(key: string, patch: Partial<LeaveDraft> | ((d: LeaveDraft) => Partial<LeaveDraft>)) {
    setDrafts(ds => ds.map(d => (d.key === key ? { ...d, ...(typeof patch === 'function' ? patch(d) : patch) } : d)));
  }

  function removeDraft(key: string) {
    setDrafts(ds => ds.filter(d => d.key !== key));
  }

  /**
   * One or many photos/PDFs at once — each becomes its own draft immediately
   * (so the list fills in as they're picked rather than waiting on every
   * scan to finish), then gets read in parallel. A file type that can't be
   * read (not image or PDF) is still kept as a draft, just left for manual
   * entry instead of blocking the rest of the batch.
   */
  async function handleLeaveFiles(files: File[]) {
    if (!files.length) return;
    setDraftsError('');
    const newDrafts: LeaveDraft[] = files.map(file => ({
      key: newDraftKey(), file, status: 'reading', note: '', editing: false,
      staff_id: '', extraStaff: [], leave_type: 'day_off', start_date: '', end_date: '', notes: '',
    }));
    setDrafts(ds => [...ds, ...newDrafts]);

    await Promise.all(newDrafts.map(async draft => {
      const file = draft.file!;
      const isImage = file.type.startsWith('image/');
      const isPdf = file.type === 'application/pdf';
      if (!isImage && !isPdf) {
        updateDraft(draft.key, { status: 'ready', editing: true, note: "This file type can't be read automatically — fill in the details by hand." });
        return;
      }

      try {
        const payload = isPdf
          ? { pdf: await readPdfAsBase64(file) }
          : await downscalePhoto(file).then(({ base64, mediaType }) => ({ image: base64, mediaType }));

        const res = await postJson<{ form_type: string; staff_names: string[]; start_date: string; end_date: string; notes: string }>(
          '/api/scan-leave-form', payload, { timeoutMs: 70_000 }
        );
        if (!res.ok || !res.data) {
          updateDraft(draft.key, { status: 'ready', editing: true, note: res.error ?? 'Could not read that form — fill it in by hand.' });
          return;
        }

        const { form_type, staff_names, start_date, end_date, notes } = res.data;
        const matches = staff_names.map(rawName => ({ rawName, id: matchStaffName(rawName, staff) ?? '' }));
        const unmatchedCount = matches.filter(m => !m.id).length;
        const note = [
          staff_names.length ? `Read from form: ${staff_names.join(', ')}.` : '',
          unmatchedCount
            ? `Could not auto-match ${unmatchedCount === 1 ? 'one of these' : `${unmatchedCount} of these`} to a staff member — check below.`
            : '',
          start_date ? '' : 'Could not read a date off the form — check it by hand.',
        ].filter(Boolean).join(' ');

        updateDraft(draft.key, {
          status: 'ready',
          staff_id: matches[0]?.id ?? '',
          extraStaff: matches.slice(1),
          leave_type: form_type === 'request_day_off' ? 'day_off' : form_type === 'farmer_jacks_leave' ? 'leave' : 'day_off',
          start_date: start_date || '',
          end_date: end_date || start_date || '',
          notes: notes || '',
          note,
          // Auto-expand only the ones that actually need a look — a clean
          // read stays collapsed so a big batch doesn't turn into a wall of
          // open forms to scroll past.
          editing: unmatchedCount > 0 || !matches[0]?.id || !start_date,
        });
      } catch (err) {
        updateDraft(draft.key, {
          status: 'error', editing: true,
          note: err instanceof Error ? err.message : 'Could not read that form — fill it in by hand.',
        });
      }
    }));
  }

  /** Saves every valid, non-reading draft — one POST per staff member named
   *  on a form, same as before. A draft that fails to save stays in the
   *  list with the error attached, rather than losing the whole batch.
   *  Wrapped in try/finally so a thrown network error (not just a non-ok
   *  response) can never leave the button stuck on "Saving…" forever —
   *  that was the actual bug, not the batch logic itself. */
  async function saveDrafts() {
    setDraftsError('');
    const toSave = drafts.filter(d => d.status !== 'reading' && draftIsValid(d));
    if (!toSave.length) {
      setDraftsError('Nothing ready to save yet — each entry needs at least a staff member and both dates.');
      return;
    }
    const posts = toSave.flatMap(d => draftStaffIds(d).map(staff_id => ({ d, staff_id })));
    setSavingDrafts(true);
    setSavingProgress({ done: 0, total: posts.length });
    const failedKeys = new Set<string>();
    try {
      let done = 0;
      for (const { d, staff_id } of posts) {
        const fd = new FormData();
        fd.append('staff_id', staff_id);
        fd.append('leave_type', d.leave_type);
        fd.append('start_date', d.start_date);
        fd.append('end_date', d.end_date);
        if (d.notes.trim()) fd.append('notes', d.notes.trim());
        if (d.file) fd.append('file', d.file);
        try {
          const res = await fetch('/api/staff-leave', { method: 'POST', body: fd });
          if (!res.ok) {
            failedKeys.add(d.key);
            const error = (await res.json().catch(() => ({}))).error ?? 'Could not save this one — try again.';
            updateDraft(d.key, { note: error, editing: true });
          }
        } catch (err) {
          failedKeys.add(d.key);
          updateDraft(d.key, { note: err instanceof Error ? err.message : 'Could not reach the server — try again.', editing: true });
        }
        done += 1;
        setSavingProgress({ done, total: posts.length });
      }
      setDrafts(ds => ds.filter(d => failedKeys.has(d.key) || !toSave.some(t => t.key === d.key)));
      if (failedKeys.size) {
        setDraftsError(`${failedKeys.size} ${failedKeys.size === 1 ? 'entry' : 'entries'} couldn't be saved — see below.`);
      }
      await loadLeave();
    } finally {
      setSavingDrafts(false);
      setSavingProgress(null);
    }
  }

  async function deleteLeave(id: string) {
    if (!confirm('Delete this record? This removes the exclusion for those dates too.')) return;
    await fetch(`/api/staff-leave/${id}`, { method: 'DELETE' });
    loadLeave();
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

  // Holidays: one row per staff member who's actually on leave somewhere in
  // the visible month — an empty row for everyone else would just be noise.
  const monthDates = useMemo(() => monthDateList(calendarMonth), [calendarMonth]);
  const holidayRows = useMemo(() => holidayRowsFor(monthDates, leaveEntries), [monthDates, leaveEntries]);

  // Year scale: the same per-month rows, computed once for all twelve months
  // of the visible year rather than re-deriving them per panel on every render.
  const yearMonths = useMemo(() => {
    const year = calendarMonth.slice(0, 4);
    return Array.from({ length: 12 }, (_, i) => {
      const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
      const dates = monthDateList(ym);
      return { yearMonth: ym, dates, rows: holidayRowsFor(dates, leaveEntries) };
    });
  }, [calendarMonth, leaveEntries]);

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
          <button
            onClick={() => setView('holidays')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              view === 'holidays' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <CalendarDays size={14} /> Holidays
          </button>
        </div>
      </div>

      {loadError && <ErrorBanner message={loadError} onRetry={load} />}

      {view === 'holidays' ? (
        <div className="card p-4">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <h2 className="font-semibold text-slate-800">Staff on Holidays</h2>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                <button
                  onClick={() => setCalendarScale('month')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    calendarScale === 'month' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Month
                </button>
                <button
                  onClick={() => setCalendarScale('year')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    calendarScale === 'year' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Year
                </button>
              </div>
              <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white">
                <button
                  onClick={() => setCalendarMonth(m => (calendarScale === 'year' ? addYears(m, -1) : addMonths(m, -1)))}
                  className="p-2 text-slate-500 hover:bg-slate-50 rounded-l-lg"
                  title={calendarScale === 'year' ? 'Previous year' : 'Previous month'}
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="px-3 py-1.5 text-sm font-medium text-slate-700 min-w-[9rem] text-center">
                  {calendarScale === 'year' ? calendarMonth.slice(0, 4) : monthLabel(calendarMonth)}
                </span>
                <button
                  onClick={() => setCalendarMonth(m => (calendarScale === 'year' ? addYears(m, 1) : addMonths(m, 1)))}
                  className="p-2 text-slate-500 hover:bg-slate-50 rounded-r-lg"
                  title={calendarScale === 'year' ? 'Next year' : 'Next month'}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span className="flex items-center gap-1"><CalendarX size={12} className="text-amber-500" /> Day off</span>
                <span className="flex items-center gap-1"><Umbrella size={12} className="text-blue-500" /> Leave</span>
              </div>
            </div>
          </div>

          {calendarScale === 'month' ? (
            holidayRows.length === 0 ? (
              <p className="text-slate-400 text-center py-16">No one is on leave in {monthLabel(calendarMonth)}.</p>
            ) : (
              <>
                {/* A date-axis bar chart has no good answer at phone width —
                    below sm it's a plain list instead, same data either way. */}
                <div className="sm:hidden"><HolidayList rows={holidayRows} /></div>
                <div className="hidden sm:block overflow-x-auto">
                  <MonthHolidayGantt monthDates={monthDates} rows={holidayRows} />
                </div>
              </>
            )
          ) : (
            <div className="space-y-4">
              {yearMonths.map(({ yearMonth, dates, rows }) => (
                <div key={yearMonth}>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                    {monthLabel(yearMonth).replace(` ${calendarMonth.slice(0, 4)}`, '')}
                  </p>
                  {rows.length === 0 ? (
                    <p className="text-xs text-slate-300 pl-1">No leave</p>
                  ) : (
                    <>
                      <div className="sm:hidden"><HolidayList rows={rows} /></div>
                      <div className="hidden sm:block overflow-x-auto">
                        <MonthHolidayGantt monthDates={dates} rows={rows} compact />
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : view === 'editor' ? (
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
            <div className="table-scroll-y">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="sticky top-0 z-10 bg-white text-left px-3 py-2 text-slate-500 font-semibold w-36">Staff</th>
                    {DAY_SHORT.map(d => <th key={d} className="sticky top-0 z-10 bg-white px-3 py-2 text-slate-500 font-semibold text-center">{d}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {staffWithAvail.map(({ staff: s, days }) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-700"><StaffName staffId={s.id} name={s.name} /></td>
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
              <div className="min-w-[620px] sm:min-w-[900px]">
                {/* Hour header */}
                <div className="flex pl-24 sm:pl-36">
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
                        <div className="w-24 sm:w-36 flex-shrink-0 pr-2 text-sm font-medium text-slate-700 truncate">
                          <StaffName staffId={s.id} name={s.name} />
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
          already does. Shown on every tab, including Holidays, so saving one
          here updates the calendar right above it without switching tabs. */}
      <div className="card p-4">
        <h2 className="font-semibold text-slate-800 mb-1 flex items-center gap-2">
          <CalendarX size={16} className="text-slate-400" /> Time Off
        </h2>
        <p className="text-xs text-slate-500 mb-4">
          Upload one or more Request Day Off or Leave forms at once — each photo or PDF is read automatically. Check the summary below before saving; anything misread stays open to fix.
        </p>

        <div className="flex items-center gap-4 mb-4 pb-4 border-b border-slate-100 flex-wrap">
          <label className="btn-secondary cursor-pointer">
            <Upload size={14} /> Upload leave forms
            <input
              type="file" multiple accept="image/*,application/pdf" className="hidden"
              onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void handleLeaveFiles(files); }}
            />
          </label>
          <button
            type="button"
            onClick={() => setDrafts(ds => [...ds, blankDraft()])}
            className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            <Plus size={14} /> Add manually
          </button>
        </div>

        {drafts.length > 0 && (
          <div className="space-y-2 mb-4 pb-4 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Pending ({drafts.length}) — review before saving
            </p>
            {drafts.map(d => (
              <LeaveDraftRow key={d.key} draft={d} staffList={staff} onUpdate={updateDraft} onRemove={removeDraft} />
            ))}
            {draftsError && <p className="text-sm text-red-600">{draftsError}</p>}

            {savingProgress && (
              <div className="space-y-1">
                <div className="flex items-baseline justify-between text-xs text-slate-500">
                  <span>Saving {savingProgress.done} of {savingProgress.total}…</span>
                  <span className="tabular-nums">{Math.round((savingProgress.done / savingProgress.total) * 100)}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-[width] duration-200 ease-linear"
                    style={{ width: `${(savingProgress.done / savingProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={saveDrafts}
                disabled={savingDrafts || drafts.some(d => d.status === 'reading') || !drafts.some(draftIsValid)}
                className="btn-primary"
              >
                <Save size={14} /> {savingDrafts ? 'Saving...' : `Save All (${drafts.filter(draftIsValid).length})`}
              </button>
            </div>
          </div>
        )}

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
                  {l.staff?.name && l.staff_id ? (
                    <StaffName staffId={l.staff_id} name={l.staff.name} className="font-medium text-slate-700" />
                  ) : (
                    <span className="font-medium text-slate-700">—</span>
                  )}
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
