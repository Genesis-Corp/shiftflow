'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Pencil, Trash2, Coffee, Download, List, GanttChartSquare,
  History, ChevronLeft, ChevronRight, Camera, FileText, FileSpreadsheet, Thermometer,
} from 'lucide-react';
import Modal from '@/components/Modal';
import ErrorBanner from '@/components/ErrorBanner';
import UploadMenu from '@/components/UploadMenu';
import DropOverlay from '@/components/DropOverlay';
import { fetchJson } from '@/lib/apiClient';
import { postJson } from '@/lib/api';
import { Shift, Department } from '@/lib/types';
import {
  formatDate, formatDuration, requiresBreak, BREAK_DURATION_MINUTES,
  TIMELINE_START_HOUR, TIMELINE_END_HOUR, timelineBarPosition, formatHour12, addDays, isBirthday, todayStr,
} from '@/lib/shiftUtils';
import { normalizeDeptColor, deptTextColor } from '@/lib/deptColors';
import { downscalePhoto } from '@/lib/image';
import { readPdfAsBase64 } from '@/lib/pdf';
import ProgressBar, { ProgressStage } from '@/components/ProgressBar';
import { STAGES } from '@/lib/progressStages';
import { RosterEntry, RosterJob, matchDepartment, groupRosterEntries } from '@/lib/roster';
import RosterQueue from '@/components/RosterQueue';
import type { RosterPlan } from '@/app/api/import-roster/route';
import { useFileDrop } from '@/lib/useFileDrop';
import Papa from 'papaparse';

/** A roster job in flight, tagged with the source file so it can be re-read
 *  and with which kind of source it is — a PDF is read whole, a photo is
 *  downscaled first. */
type QueuedRosterJob = RosterJob & { file: File; kind: 'image' | 'pdf' };

const STATUS_BADGE: Record<string, string> = {
  open: 'badge-red',
  covered: 'badge-green',
  cancelled: 'badge-slate',
};

interface DayGroup { date: string; shifts: Shift[] }
interface DeptGroup { department_id: string; name: string; color: string | null | undefined; shifts: Shift[] }

/** Shifts arrive sorted by date, start_time (the API orders both), so a
 *  filtered subset stays in that order — this is a single grouping pass,
 *  no re-sorting needed. */
function groupByDate(list: Shift[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const s of list) {
    const last = groups[groups.length - 1];
    if (last && last.date === s.date) last.shifts.push(s);
    else groups.push({ date: s.date, shifts: [s] });
  }
  return groups;
}

function assignedName(s: Shift): string | null {
  return (s as { assigned_staff?: { name: string } }).assigned_staff?.name ?? null;
}

function assignedBirthday(s: Shift): string | null | undefined {
  return (s as { assigned_staff?: { birthday?: string | null } }).assigned_staff?.birthday;
}

/** One day's shifts, split into a colored section per department and sorted
 *  by assigned staff name within each — unassigned shifts sort last. */
function groupByDepartment(shifts: Shift[]): DeptGroup[] {
  const map = new Map<string, DeptGroup>();
  for (const s of shifts) {
    const id = s.department_id;
    if (!map.has(id)) {
      map.set(id, { department_id: id, name: s.departments?.name ?? 'Unknown', color: s.departments?.color, shifts: [] });
    }
    map.get(id)!.shifts.push(s);
  }
  const groups = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  for (const g of groups) {
    g.shifts.sort((a, b) => (assignedName(a) ?? '￿').localeCompare(assignedName(b) ?? '￿'));
  }
  return groups;
}

function ShiftDayGroup({
  group, onAdjust, onEdit, onRemove, onCalledInSick,
}: {
  group: DayGroup;
  onAdjust: (s: Shift) => void; onEdit: (s: Shift) => void; onRemove: (s: Shift) => void;
  onCalledInSick: (s: Shift) => void;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
        <span className="font-semibold text-slate-800 text-sm">{formatDate(group.date)}</span>
        <span className="badge-slate">{group.shifts.length}</span>
      </div>
      {groupByDepartment(group.shifts).map(dg => (
        <div key={dg.department_id} className="border-l-4" style={{ borderLeftColor: normalizeDeptColor(dg.color) }}>
          <div className="px-4 py-1.5 bg-slate-50/60 border-b border-slate-100 flex items-center gap-2">
            <span
              className="badge"
              style={{ backgroundColor: normalizeDeptColor(dg.color), color: deptTextColor(dg.color) }}
            >
              {dg.name}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100">
              <tr>
                {['Time', 'Duration', 'Role', 'Break', 'Status', 'Assigned', ''].map(h => (
                  <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dg.shifts.map(s => {
                const name = assignedName(s);
                const isBday = isBirthday(assignedBirthday(s), group.date);
                return (
                  <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-slate-800">{s.start_time} – {s.end_time}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDuration(s.start_time, s.end_time)}</td>
                    <td className="px-4 py-3">
                      <span className="badge-slate capitalize">{s.required_role}</span>
                    </td>
                    <td className="px-4 py-3">
                      {s.has_break ? <span className="badge-amber"><Coffee size={11} className="mr-1" />{s.break_duration_minutes}m</span> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={STATUS_BADGE[s.status] ?? 'badge-slate'}>{s.status}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {name ?? '—'}{isBday && <span title="Birthday today" className="ml-1">🎁</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {s.assigned_staff_id && (
                          <button onClick={() => onCalledInSick(s)} title="Called in sick — reopen this shift" className="btn-ghost p-1.5 text-amber-500">
                            <Thermometer size={13} />
                          </button>
                        )}
                        <button onClick={() => onAdjust(s)} title="Adjust times" className="btn-ghost p-1.5 text-blue-500"><Coffee size={13} /></button>
                        <button onClick={() => onEdit(s)} className="btn-ghost p-1.5"><Pencil size={14} /></button>
                        <button onClick={() => onRemove(s)} className="btn-ghost p-1.5 text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export default function ShiftsPage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState<'add' | 'edit' | 'adjust' | null>(null);
  const [editing, setEditing] = useState<Shift | null>(null);
  const [view, setView] = useState<'list' | 'timeline' | 'past'>('list');

  // Timeline is the one view that looks at a single day, so it gets its own
  // date + department, steppable without touching the network — everything
  // it needs is already in `shifts` once loaded.
  const [timelineDate, setTimelineDate] = useState(todayStr());
  const [timelineDept, setTimelineDept] = useState('');

  const [form, setForm] = useState({
    date: '', start_time: '09:00', end_time: '17:00',
    department_id: '', required_role: 'any', notes: '',
  });

  const [adjustForm, setAdjustForm] = useState({ start_time: '', end_time: '' });

  // Roster photos/PDFs waiting to become shifts.
  const [stage, setStage] = useState<ProgressStage | null>(null);
  const [jobs, setJobs] = useState<RosterJob[]>([]);
  const [queueOpen, setQueueOpen] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  /** Sources are read one at a time; this stops a second reader starting. */
  const reading = useRef(false);

  // Load everything once. List/Past/Timeline are all just different slices
  // of the same array — no per-view refetch, and stepping the timeline's day
  // is instant instead of a round trip.
  async function load() {
    setLoading(true);
    try {
      const [shiftsData, deptData] = await Promise.all([
        fetchJson<Shift[]>('/api/shifts'),
        fetchJson<Department[]>('/api/departments'),
      ]);
      setShifts(shiftsData);
      setDepartments(deptData);
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load shifts');
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  /**
   * Queue up whatever was picked. Each source is one day in one department, so
   * each becomes its own job with its own date, department and confirmation —
   * and each is read in its own request, which is what keeps a batch of them
   * clear of the hosting platform's per-request time limit.
   */
  function queueRosterFiles(files: File[]) {
    if (!files.length) return;

    if (!departments.length) {
      alert('Add a department before importing a roster — every shift belongs to one.');
      return;
    }

    const today = todayStr();
    setJobs(current => [
      ...current,
      ...files.map<QueuedRosterJob>((file, i) => ({
        id: `${Date.now()}-${i}-${file.name}`,
        name: file.name,
        status: 'pending',
        entries: [],
        warnings: [],
        date: today,
        department_id: departments[0].id,
        logNoShows: false,
        file,
        kind: file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image',
      })),
    ]);
    setQueueOpen(true);
  }

  /** Work through the queue one source at a time. */
  useEffect(() => {
    if (reading.current) return;
    const next = jobs.find(j => j.status === 'pending') as QueuedRosterJob | undefined;
    if (!next?.file) return;

    reading.current = true;
    void readJob(next).finally(() => {
      reading.current = false;
      setJobs(current => [...current]); // nudge the queue on to the next source
    });
  }, [jobs]); // eslint-disable-line react-hooks/exhaustive-deps

  async function readJob(job: QueuedRosterJob) {
    const update = (patch: Partial<RosterJob>) =>
      setJobs(current => current.map(j => (j.id === job.id ? { ...j, ...patch } : j)));

    update({ status: 'reading' });
    const position = jobs.filter(j => j.status === 'applied' || j.status === 'ready' || j.status === 'failed').length + 1;
    const label = jobs.length > 1 ? `Reading roster ${position} of ${jobs.length}…` : STAGES.readingRoster.label;

    try {
      let scan;
      if (job.kind === 'pdf') {
        setStage({ ...STAGES.preparingPdf });
        const pdf = await readPdfAsBase64(job.file);
        setStage({ ...STAGES.readingRoster, label });
        scan = await postJson<{
          department: string | null;
          date: string | null;
          entries: RosterEntry[];
          warnings: string[];
          seconds?: number;
        }>('/api/scan-roster', { pdf }, { timeoutMs: 70_000 });
      } else {
        setStage({ ...STAGES.preparing });
        const { base64, mediaType } = await downscalePhoto(job.file);
        setStage({ ...STAGES.readingRoster, label });
        scan = await postJson<{
          department: string | null;
          date: string | null;
          entries: RosterEntry[];
          warnings: string[];
          seconds?: number;
        }>('/api/scan-roster', { image: base64, mediaType }, { timeoutMs: 70_000 });
      }

      if (!scan.ok || !scan.data) {
        update({ status: 'failed', error: scan.error ?? 'Could not be read.' });
        return;
      }
      const data = scan.data;

      // Neither the day nor the department is reliably printed on a source, so
      // each is taken from it when it is there and left to be checked when it
      // is not. A whole-store report lists more than one department in the
      // same source — each row then carries its own, and the single job
      // splits into one per department found so each can be checked and
      // added on its own.
      const docHeading = data.department ?? null;
      const date = data.date ?? job.date;
      const groups = groupRosterEntries(data.entries, docHeading);

      if (groups.length <= 1) {
        const heading = groups[0]?.label ?? docHeading;
        const matched = matchDepartment(heading ?? undefined, departments);
        const departmentId = matched?.id ?? job.department_id;

        update({
          status: 'ready',
          entries: data.entries,
          warnings: data.warnings,
          seconds: data.seconds,
          heading: heading ? { text: heading, matched: Boolean(matched) } : null,
          date,
          department_id: departmentId,
        });

        await previewJob({ ...job, entries: data.entries, date, department_id: departmentId });
        return;
      }

      const splitJobs: QueuedRosterJob[] = groups.map((group, i) => {
        const matched = matchDepartment(group.label ?? undefined, departments);
        return {
          ...job,
          id: i === 0 ? job.id : `${job.id}-${i}`,
          name: group.label ? `${job.name} — ${group.label}` : job.name,
          status: 'ready',
          entries: group.entries,
          warnings: data.warnings,
          seconds: data.seconds,
          heading: group.label ? { text: group.label, matched: Boolean(matched) } : null,
          date,
          department_id: matched?.id ?? departments[0].id,
        };
      });

      setJobs(current => {
        const idx = current.findIndex(j => j.id === job.id);
        if (idx === -1) return [...current, ...splitJobs];
        return [...current.slice(0, idx), ...splitJobs, ...current.slice(idx + 1)];
      });

      for (const splitJob of splitJobs) {
        await previewJob(splitJob);
      }
    } catch (err) {
      update({ status: 'failed', error: err instanceof Error ? err.message : 'Could not be read.' });
    } finally {
      setStage(null);
    }
  }

  async function previewJob(job: RosterJob) {
    const preview = await postJson<RosterPlan>(
      '/api/import-roster',
      { date: job.date, department_id: job.department_id, entries: job.entries, mode: 'preview' },
      { timeoutMs: 60_000 }
    );
    setJobs(current =>
      current.map(j =>
        j.id === job.id
          ? { ...j, plan: preview.data ?? undefined, error: preview.ok ? undefined : preview.error ?? undefined }
          : j
      )
    );
  }

  /** The date and department decide what counts as a duplicate, so re-check on a change. */
  async function changeJobTarget(id: string, date: string, department_id: string) {
    const job = jobs.find(j => j.id === id);
    if (!job) return;
    setJobs(current => current.map(j => (j.id === id ? { ...j, date, department_id } : j)));
    await previewJob({ ...job, date, department_id });
  }

  function toggleJobNoShows(id: string, value: boolean) {
    setJobs(current => current.map(j => (j.id === id ? { ...j, logNoShows: value } : j)));
  }

  function removeJob(id: string) {
    setJobs(current => {
      const left = current.filter(j => j.id !== id);
      if (!left.length) setQueueOpen(false);
      return left;
    });
  }

  async function applyJob(id: string): Promise<boolean> {
    const job = jobs.find(j => j.id === id);
    if (!job) return false;

    setApplying(id);
    const applied = await postJson<RosterPlan>(
      '/api/import-roster',
      { date: job.date, department_id: job.department_id, entries: job.entries, mode: 'apply', logNoShows: job.logNoShows },
      { timeoutMs: 60_000 }
    );
    setApplying(null);

    if (!applied.ok || !applied.data) {
      setJobs(current => current.map(j => (j.id === id ? { ...j, error: applied.error ?? 'Could not be added.' } : j)));
      return false;
    }

    setJobs(current =>
      current.map(j => (j.id === id ? { ...j, status: 'applied', applied: applied.data!.applied ?? { shifts_created: 0, incidents_logged: 0 } } : j))
    );
    await load();
    return true;
  }

  /** Add every roster that has been read and checked, in order. */
  async function applyAllJobs() {
    for (const job of jobs.filter(j => j.status === 'ready')) {
      const ok = await applyJob(job.id);
      if (!ok) break; // stop at the first failure rather than pressing on blindly
    }
  }

  function openAdd() {
    setForm({ date: todayStr(), start_time: '09:00', end_time: '17:00', department_id: departments[0]?.id ?? '', required_role: 'any', notes: '' });
    setModal('add');
  }

  function openEdit(s: Shift) {
    setEditing(s);
    setForm({ date: s.date, start_time: s.start_time, end_time: s.end_time, department_id: s.department_id, required_role: s.required_role, notes: s.notes ?? '' });
    setModal('edit');
  }

  function openAdjust(s: Shift) {
    setEditing(s);
    setAdjustForm({ start_time: s.start_time, end_time: s.end_time });
    setModal('adjust');
  }

  const breakPreview = requiresBreak(form.start_time, form.end_time);

  async function save() {
    if (!form.date || !form.department_id) return;
    if (modal === 'add') {
      await fetch('/api/shifts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    } else if (editing) {
      await fetch(`/api/shifts/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    }
    setModal(null); load();
  }

  async function saveAdjust() {
    if (!editing) return;
    await fetch(`/api/shifts/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(adjustForm) });
    setModal(null); load();
  }

  async function remove(s: Shift) {
    if (!confirm('Delete this shift?')) return;
    await fetch(`/api/shifts/${s.id}`, { method: 'DELETE' });
    load();
  }

  /** Reopens the shift so it shows up on Cover Shift like any other open
   *  shift — the same state a lost claim race leaves it in. */
  async function calledInSick(s: Shift) {
    if (!confirm(`Mark ${(s as { assigned_staff?: { name: string } }).assigned_staff?.name ?? 'this person'} as called in sick and reopen the shift?`)) return;
    await fetch(`/api/shifts/${s.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'open', assigned_staff_id: null }),
    });
    load();
  }

  async function handleImportCsv(file: File) {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (result) => {
        const res = await fetch('/api/import-shifts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: result.data }),
        });
        const { created, skipped, errors } = await res.json();
        const msg = [`Imported ${created} shift${created !== 1 ? 's' : ''}.`];
        if (skipped) msg.push(`${skipped} skipped.`);
        if (errors?.length) msg.push(`Errors:\n${errors.join('\n')}`);
        alert(msg.join(' '));
        load();
      },
    });
  }

  async function handleExport() {
    const res = await fetch('/api/export?type=shifts');
    const { rows, filename } = await res.json();
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  }

  const today = todayStr();

  // List: today onward. Past: everything before today, most recent day
  // first (reverse the day GROUPS, not the shifts inside each — morning
  // still comes before afternoon when you look at a past day).
  const futureGroups = useMemo(
    () => groupByDate(shifts.filter(s => s.date >= today)),
    [shifts, today]
  );
  const pastGroups = useMemo(
    () => [...groupByDate(shifts.filter(s => s.date < today))].reverse(),
    [shifts, today]
  );

  const timelineHours = useMemo(
    () => Array.from(
      { length: TIMELINE_END_HOUR - TIMELINE_START_HOUR },
      (_, i) => TIMELINE_START_HOUR + i
    ),
    []
  );

  // Timeline rows are staff, not departments — an open shift has nobody to
  // hang a row off, so it gets a dedicated "Unassigned" row up top instead
  // of disappearing.
  const timelineShifts = useMemo(
    () => shifts.filter(s => s.date === timelineDate && (!timelineDept || s.department_id === timelineDept)),
    [shifts, timelineDate, timelineDept]
  );
  const { unassigned, staffRows } = useMemo(() => {
    const byStaff = new Map<string, { name: string; birthday?: string | null; shifts: Shift[] }>();
    const open: Shift[] = [];
    for (const s of timelineShifts) {
      const assignedName = (s as { assigned_staff?: { name: string } }).assigned_staff?.name;
      const birthday = (s as { assigned_staff?: { birthday?: string | null } }).assigned_staff?.birthday;
      if (s.assigned_staff_id && assignedName) {
        if (!byStaff.has(s.assigned_staff_id)) byStaff.set(s.assigned_staff_id, { name: assignedName, birthday, shifts: [] });
        byStaff.get(s.assigned_staff_id)!.shifts.push(s);
      } else {
        open.push(s);
      }
    }
    return {
      unassigned: open,
      staffRows: Array.from(byStaff.values()).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [timelineShifts]);

  /** Each bar fills with its own department's color, so someone working two
   *  departments the same day shows both colors on their one row. Open
   *  shifts still stand out with a red ring, cancelled ones are faded. */
  function timelineBar(s: Shift) {
    const pos = timelineBarPosition(s.start_time, s.end_time);
    if (!pos) return null;
    const deptName = s.departments?.name ?? departments.find(d => d.id === s.department_id)?.name;
    const isCancelled = s.status === 'cancelled';
    const isOpen = s.status === 'open';
    const fill = isCancelled ? '#cbd5e1' : normalizeDeptColor(s.departments?.color);
    const textColor = isCancelled ? '#334155' : deptTextColor(s.departments?.color);
    return (
      <div
        key={s.id}
        title={`${s.start_time}–${s.end_time} · ${s.status}${deptName ? ` · ${deptName}` : ''}`}
        onClick={() => openEdit(s)}
        className={`absolute inset-y-0.5 rounded flex items-center px-1.5 overflow-hidden cursor-pointer ${
          isOpen ? 'ring-2 ring-red-500 ring-offset-1' : ''
        } ${isCancelled ? 'opacity-60' : ''}`}
        style={{ left: `${pos.leftPct}%`, width: `${pos.widthPct}%`, backgroundColor: fill }}
      >
        <span
          className={`text-[11px] font-medium whitespace-nowrap ${isCancelled ? 'line-through' : ''}`}
          style={{ color: textColor }}
        >
          {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}{deptName ? ` · ${deptName}` : ''}
        </span>
      </div>
    );
  }

  const busy = stage !== null || applying !== null;

  const { dragging, dropHandlers } = useFileDrop(files => {
    const csvFiles = files.filter(f => f.name.toLowerCase().endsWith('.csv'));
    const rosterFiles = files.filter(f => !f.name.toLowerCase().endsWith('.csv'));
    if (rosterFiles.length) queueRosterFiles(rosterFiles);
    for (const csvFile of csvFiles) void handleImportCsv(csvFile);
  }, busy);

  return (
    <div className="space-y-4" {...dropHandlers}>
      <DropOverlay active={dragging} label="Drop a roster photo, PDF or CSV to import" />
      {stage && <ProgressBar stage={stage} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Shifts</h1>
          <p className="text-sm text-slate-500">{shifts.length} shifts total</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              onClick={() => setView('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                view === 'list' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <List size={14} /> List
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
              onClick={() => setView('past')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                view === 'past' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <History size={14} /> Past
            </button>
          </div>

          {view === 'timeline' && (
            <>
              <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white">
                <button onClick={() => setTimelineDate(d => addDays(d, -1))} className="p-2 text-slate-500 hover:bg-slate-50 rounded-l-lg" title="Previous day">
                  <ChevronLeft size={16} />
                </button>
                <input
                  type="date" value={timelineDate} onChange={e => setTimelineDate(e.target.value)}
                  className="border-x border-slate-200 px-2 py-1.5 text-sm focus:outline-none"
                />
                <button onClick={() => setTimelineDate(d => addDays(d, 1))} className="p-2 text-slate-500 hover:bg-slate-50 rounded-r-lg" title="Next day">
                  <ChevronRight size={16} />
                </button>
              </div>
              <select className="input w-auto" value={timelineDept} onChange={e => setTimelineDept(e.target.value)}>
                <option value="">All Departments</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </>
          )}

          <UploadMenu
            disabled={busy}
            options={[
              {
                key: 'capture',
                label: 'Capture',
                icon: <Camera size={14} />,
                accept: 'image/*',
                capture: 'environment',
                onChange: e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; queueRosterFiles(files); },
              },
              {
                key: 'photos',
                label: 'Upload Rosters',
                icon: <FileText size={14} />,
                accept: 'image/*',
                multiple: true,
                onChange: e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; queueRosterFiles(files); },
              },
              {
                key: 'pdf',
                label: 'Upload PDF',
                icon: <FileText size={14} />,
                accept: 'application/pdf',
                multiple: true,
                onChange: e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; queueRosterFiles(files); },
              },
              {
                key: 'csv',
                label: 'Import CSV',
                icon: <FileSpreadsheet size={14} />,
                accept: '.csv',
                onChange: e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void handleImportCsv(file); },
              },
            ]}
          />
          <button onClick={handleExport} className="btn-secondary"><Download size={14} /> Export</button>
          <button onClick={openAdd} className="btn-primary"><Plus size={16} /> Add Shift</button>
        </div>
      </div>

      {loadError && <ErrorBanner message={loadError} onRetry={load} />}

      {loading ? <p className="text-slate-400">Loading...</p> : loadError ? null : view === 'list' ? (
        <div className="space-y-4">
          {futureGroups.length === 0 && (
            <div className="card"><p className="text-center text-slate-400 py-8">No upcoming shifts.</p></div>
          )}
          {futureGroups.map(g => (
            <ShiftDayGroup key={g.date} group={g} onAdjust={openAdjust} onEdit={openEdit} onRemove={remove} onCalledInSick={calledInSick} />
          ))}
        </div>
      ) : view === 'past' ? (
        <div className="space-y-4">
          {pastGroups.length === 0 && (
            <div className="card"><p className="text-center text-slate-400 py-8">No past shifts.</p></div>
          )}
          {pastGroups.map(g => (
            <ShiftDayGroup key={g.date} group={g} onAdjust={openAdjust} onEdit={openEdit} onRemove={remove} onCalledInSick={calledInSick} />
          ))}
        </div>
      ) : (
        <div className="card p-4">
          <h2 className="font-semibold text-slate-800 mb-4">
            {formatDate(timelineDate)}{timelineDept && ` · ${departments.find(d => d.id === timelineDept)?.name}`}
          </h2>
          {timelineShifts.length === 0 ? (
            <p className="text-slate-400 text-center py-8">No shifts scheduled.</p>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[900px]">
                <div className="flex pl-36">
                  {timelineHours.map(h => (
                    <div key={h} className="flex-1 text-[11px] text-slate-400 font-medium border-l border-slate-100 pl-1">
                      {formatHour12(h)}
                    </div>
                  ))}
                </div>

                <div className="mt-1 divide-y divide-slate-100">
                  {unassigned.length > 0 && (
                    <div className="flex items-center py-2">
                      <div className="w-36 flex-shrink-0 pr-2 text-sm font-medium text-amber-700 italic truncate">
                        Unassigned
                      </div>
                      <div className="relative flex-1 h-7 rounded bg-amber-50/50">
                        <div className="absolute inset-0 flex pointer-events-none">
                          {timelineHours.map(h => (
                            <div key={h} className="flex-1 border-l border-slate-100 first:border-l-0" />
                          ))}
                        </div>
                        {unassigned.map(timelineBar)}
                      </div>
                    </div>
                  )}

                  {staffRows.map(({ name, birthday, shifts: rowShifts }) => (
                    <div key={name} className="flex items-center py-2">
                      <div className="w-36 flex-shrink-0 pr-2 text-sm font-medium text-slate-700 truncate">
                        {name}{isBirthday(birthday, timelineDate) && <span title="Birthday today" className="ml-1">🎁</span>}
                      </div>
                      <div className="relative flex-1 h-7 rounded bg-slate-50">
                        <div className="absolute inset-0 flex pointer-events-none">
                          {timelineHours.map(h => (
                            <div key={h} className="flex-1 border-l border-slate-100 first:border-l-0" />
                          ))}
                        </div>
                        {rowShifts.map(timelineBar)}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-4 text-xs text-slate-500">
                  {departments.map(d => (
                    <span key={d.id} className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: normalizeDeptColor(d.color) }} /> {d.name}
                    </span>
                  ))}
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm ring-2 ring-red-500" /> Open</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-slate-300 opacity-60" /> Cancelled</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {(modal === 'add' || modal === 'edit') && (
        <Modal title={modal === 'add' ? 'Create Shift' : 'Edit Shift'} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label">Date</label>
                <input type="date" className="input" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div>
                <label className="label">Start Time</label>
                <input type="time" className="input" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} />
              </div>
              <div>
                <label className="label">End Time</label>
                <input type="time" className="input" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} />
              </div>
            </div>

            {breakPreview && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700 flex gap-2">
                <Coffee size={15} className="mt-0.5 flex-shrink-0" />
                <span>This shift is over 5.5 hours — a <strong>{BREAK_DURATION_MINUTES}-minute break</strong> will be added automatically.</span>
              </div>
            )}

            <div>
              <label className="label">Department</label>
              <select className="input" value={form.department_id} onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))}>
                <option value="">Select department...</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Required Role</label>
              <select className="input" value={form.required_role} onChange={e => setForm(f => ({ ...f, required_role: e.target.value }))}>
                <option value="any">Any</option>
                <option value="senior">Senior only</option>
                <option value="junior">Junior only</option>
              </select>
            </div>
            <div>
              <label className="label">Notes (optional)</label>
              <input className="input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any notes..." />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModal(null)} className="btn-secondary">Cancel</button>
              <button onClick={save} className="btn-primary">Save Shift</button>
            </div>
          </div>
        </Modal>
      )}

      {modal === 'adjust' && editing && (
        <Modal title={`Adjust: ${editing.departments?.name} ${editing.date}`} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <p className="text-sm text-slate-500">Current: <strong>{editing.start_time} – {editing.end_time}</strong> ({formatDuration(editing.start_time, editing.end_time)})</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">New Start Time</label>
                <input type="time" className="input" value={adjustForm.start_time} onChange={e => setAdjustForm(f => ({ ...f, start_time: e.target.value }))} />
              </div>
              <div>
                <label className="label">New End Time</label>
                <input type="time" className="input" value={adjustForm.end_time} onChange={e => setAdjustForm(f => ({ ...f, end_time: e.target.value }))} />
              </div>
            </div>
            {requiresBreak(adjustForm.start_time, adjustForm.end_time) && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700 flex gap-2">
                <Coffee size={15} className="mt-0.5" />
                <span>New duration exceeds 5.5h — break will be applied.</span>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModal(null)} className="btn-secondary">Cancel</button>
              <button onClick={saveAdjust} className="btn-primary">Apply Adjustment</button>
            </div>
          </div>
        </Modal>
      )}

      {queueOpen && jobs.length > 0 && (
        <RosterQueue
          jobs={jobs}
          departments={departments}
          applying={applying}
          onClose={() => setQueueOpen(false)}
          onChangeTarget={changeJobTarget}
          onToggleNoShows={toggleJobNoShows}
          onApply={applyJob}
          onApplyAll={applyAllJobs}
          onRemove={removeJob}
        />
      )}
    </div>
  );
}
