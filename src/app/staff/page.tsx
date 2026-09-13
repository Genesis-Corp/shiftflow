'use client';

import { useEffect, useState, useRef } from 'react';
import { Plus, Pencil, Trash2, Upload, Download, UserCheck, UserX, Camera, FileSpreadsheet } from 'lucide-react';
import ErrorBanner from '@/components/ErrorBanner';
import ProgressBar, { ProgressStage } from '@/components/ProgressBar';
import { STAGES } from '@/lib/progressStages';
import Modal from '@/components/Modal';
import ReliabilityBar from '@/components/ReliabilityBar';
import { Staff, Department, RoleType, AgeGroup, TrainingLevel, AvailabilityTemplate } from '@/lib/types';
import { DAYS, DAY_SHORT } from '@/lib/shiftUtils';
import { isAvailabilitySheet, matrixToObjects } from '@/lib/availabilitySheet';
import { fetchList, postJson } from '@/lib/api';
import { downscalePhoto } from '@/lib/image';
import type { SyncPlan } from '@/lib/staffSync';
import Papa from 'papaparse';

const ROLE_LABELS: Record<RoleType, string> = {
  department_only: 'Department Only',
  all_rounder: 'All Rounder',
  potential_all_rounder: 'Potential All Rounder',
};

interface DayAvailability {
  available: boolean;
  start_time: string;
  end_time: string;
}

/** A week with nobody rostered on, used for a new staff member. */
function emptyWeek(): Record<number, DayAvailability> {
  const week: Record<number, DayAvailability> = {};
  for (let day = 0; day < 7; day++) {
    week[day] = { available: false, start_time: '09:00', end_time: '17:00' };
  }
  return week;
}

const ROLE_BADGE: Record<RoleType, string> = {
  department_only: 'badge-slate',
  all_rounder: 'badge-green',
  potential_all_rounder: 'badge-blue',
};

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [templates, setTemplates] = useState<AvailabilityTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modal, setModal] = useState<'add' | 'edit' | null>(null);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [filter, setFilter] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  // Availability-sheet sync: the uploaded grid, the preview of what it changes,
  // and whether staff missing from it should be removed.
  const [sheet, setSheet] = useState<string[][] | null>(null);
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [removeMissing, setRemoveMissing] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [stage, setStage] = useState<ProgressStage | null>(null);
  const [fromPhoto, setFromPhoto] = useState(false);
  const [scanSeconds, setScanSeconds] = useState<number | null>(null);

  const [form, setForm] = useState({
    name: '', age_group: 'senior' as AgeGroup, role_type: 'department_only' as RoleType, phone: '',
    selectedDepts: [] as { department_id: string; training_level: TrainingLevel }[],
    availability: emptyWeek(),
  });

  async function load() {
    const [staffRes, deptRes, templateRes] = await Promise.all([
      fetchList<Staff>('/api/staff'),
      fetchList<Department>('/api/departments'),
      fetchList<AvailabilityTemplate>('/api/availability'),
    ]);
    setStaff(staffRes.data);
    setDepartments(deptRes.data);
    setTemplates(templateRes.data);
    setLoadError(staffRes.error ?? deptRes.error ?? templateRes.error);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openAdd() {
    setEditing(null);
    setForm({ name: '', age_group: 'senior', role_type: 'department_only', phone: '', selectedDepts: [], availability: emptyWeek() });
    setModal('add');
  }

  function openEdit(s: Staff) {
    setEditing(s);
    const depts = (s.staff_departments ?? []).map(d => ({
      department_id: d.department_id,
      training_level: (d.training_level ?? 'trained') as TrainingLevel,
    }));
    const week = emptyWeek();
    for (const t of templates) {
      if (t.staff_id !== s.id || !t.available) continue;
      week[t.day_of_week] = { available: true, start_time: t.start_time.slice(0, 5), end_time: t.end_time.slice(0, 5) };
    }
    setForm({ name: s.name, age_group: s.age_group, role_type: s.role_type, phone: s.phone ?? '', selectedDepts: depts, availability: week });
    setModal('edit');
  }

  function toggleDept(dept_id: string) {
    setForm(f => {
      const exists = f.selectedDepts.find(d => d.department_id === dept_id);
      if (exists) return { ...f, selectedDepts: f.selectedDepts.filter(d => d.department_id !== dept_id) };
      return { ...f, selectedDepts: [...f.selectedDepts, { department_id: dept_id, training_level: 'trained' }] };
    });
  }

  /** The seven days, with the ones this person can work picked out. */
  function DayStrip({ staffId }: { staffId: string }) {
    return (
      <div className="flex gap-0.5">
        {DAY_SHORT.map((short, day) => {
          const on = templates.some(t => t.staff_id === staffId && t.day_of_week === day && t.available);
          return (
            <span
              key={short}
              title={`${DAYS[day]}: ${on ? 'available' : 'not available'}`}
              className={`text-[10px] leading-none px-1 py-1 rounded ${on ? 'bg-green-100 text-green-700 font-semibold' : 'bg-slate-100 text-slate-300'}`}
            >
              {short[0]}
            </span>
          );
        })}
      </div>
    );
  }

  function setDay(day: number, patch: Partial<DayAvailability>) {
    setForm(f => ({ ...f, availability: { ...f.availability, [day]: { ...f.availability[day], ...patch } } }));
  }

  function setTrainingLevel(dept_id: string, level: TrainingLevel) {
    setForm(f => ({
      ...f,
      selectedDepts: f.selectedDepts.map(d => d.department_id === dept_id ? { ...d, training_level: level } : d),
    }));
  }

  async function save() {
    if (!form.name.trim()) return;
    let staffId: string;
    if (modal === 'add') {
      const res = await fetch('/api/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.name, age_group: form.age_group, role_type: form.role_type, phone: form.phone }) });
      const data = await res.json();
      staffId = data.id;
    } else if (editing) {
      await fetch(`/api/staff/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.name, age_group: form.age_group, role_type: form.role_type, phone: form.phone }) });
      staffId = editing.id;
    } else return;

    await fetch(`/api/staff/${staffId}/departments`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ departments: form.selectedDepts }) });

    await fetch('/api/availability', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        staff_id: staffId,
        templates: Object.entries(form.availability)
          .filter(([, day]) => day.available)
          .map(([day, t]) => ({ day_of_week: Number(day), start_time: t.start_time, end_time: t.end_time, available: true })),
      }),
    });

    setModal(null);
    load();
  }

  async function toggleActive(s: Staff) {
    await fetch(`/api/staff/${s.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !s.active }) });
    load();
  }

  async function remove(s: Staff) {
    if (!confirm(`Delete ${s.name}? This cannot be undone.`)) return;
    await fetch(`/api/staff/${s.id}`, { method: 'DELETE' });
    load();
  }

  async function handleExport() {
    const res = await fetch('/api/export?type=staff');
    const { rows, filename } = await res.json();
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  }

  /**
   * One entry point for everything the sheet can arrive as. Whichever button
   * was used, a photo is transcribed and a CSV is parsed — picking a photo here
   * used to fall through to the plain staff importer, which quietly did nothing.
   */
  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be picked again after a fix
    if (!file) return;

    const name = file.name.toLowerCase();
    if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/.test(name)) {
      readPhoto(file);
      return;
    }
    if (/\.(xlsx|xlsm|xls|ods|numbers)$/.test(name)) {
      alert(
        `"${file.name}" is a spreadsheet file, which the app cannot open directly.\n\n` +
        'In Excel or Google Sheets choose File → Download / Save As → CSV, then upload that. ' +
        'Or photograph the printed sheet with Capture.'
      );
      return;
    }
    if (/\.pdf$/.test(name)) {
      alert(`"${file.name}" is a PDF. Photograph the sheet with Capture instead, or export it as a CSV.`);
      return;
    }

    readCsv(file);
  }

  /** Parse a CSV: sync it when it is the availability sheet, import it otherwise. */
  function readCsv(file: File) {
    setScanSeconds(null);
    setStage(STAGES.parsing);
    Papa.parse<string[]>(file, {
      skipEmptyLines: 'greedy',
      complete: async (results) => {
        const rows = results.data;

        if (isAvailabilitySheet(rows)) {
          setStage(STAGES.comparing);
          const preview = await postJson<SyncPlan>('/api/sync-staff-sheet', { rows, mode: 'preview' }, { timeoutMs: 60_000 });
          setStage(null);
          if (!preview.ok || !preview.data) { alert(preview.error ?? 'Could not read that sheet.'); return; }
          setSheet(rows);
          setRemoveMissing(true);
          setFromPhoto(false);
          setPlan(preview.data);
          return;
        }

        // Not the availability sheet — try the plain staff CSV format.
        const imported = await postJson<{ created?: number; errors?: string[] }>(
          '/api/import',
          { rows: matrixToObjects(rows) },
          { timeoutMs: 60_000 }
        );
        const data = imported.data ?? {};
        setStage(null);

        if (!imported.ok || !data.created) {
          alert(
            `Nothing was imported from "${file.name}".\n\n` +
            'It does not look like the availability sheet — that needs a header row with the days of the week, ' +
            'and columns for the first name, last name and mobile number.\n\n' +
            'If this is a photo of the sheet, use Capture instead.'
          );
          return;
        }

        alert(`Imported ${data.created} staff. ${data.errors?.length ? `Errors: ${data.errors.join(', ')}` : ''}`);
        load();
      },
      error: (err: Error) => {
        setStage(null);
        alert(`"${file.name}" could not be read: ${err.message}`);
      },
    });
  }

  /**
   * Turn a photo of the sheet into the same grid a CSV produces, then run the
   * identical preview — which is where a misread time or digit gets caught.
   */
  async function readPhoto(file: File) {
    try {
      setStage(STAGES.preparing);
      const { base64, mediaType } = await downscalePhoto(file);

      setStage(STAGES.reading);
      const scan = await postJson<{ rows: string[][]; seconds?: number }>(
        '/api/scan-sheet',
        { image: base64, mediaType },
        { timeoutMs: 70_000 } // the server gives up first, at its own budget
      );
      if (!scan.ok || !scan.data) { alert(scan.error ?? 'Could not read that photo.'); return; }

      setStage(STAGES.comparing);
      const preview = await postJson<SyncPlan>('/api/sync-staff-sheet', { rows: scan.data.rows, mode: 'preview' }, { timeoutMs: 60_000 });
      if (!preview.ok || !preview.data) { alert(preview.error ?? 'Could not read that photo as an availability sheet.'); return; }

      setSheet(scan.data.rows);
      setRemoveMissing(true);
      setFromPhoto(true);
      setScanSeconds(scan.data.seconds ?? null);
      setPlan(preview.data);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not read that photo.');
    } finally {
      setStage(null);
    }
  }

  /**
   * The sheet as it was read, as a CSV. For a photo this is the converted
   * spreadsheet — worth keeping, and openable in Excel or Google Sheets to fix
   * anything the camera got wrong before re-uploading it.
   */
  function downloadSheetCsv() {
    if (!sheet) return;
    const csv = Papa.unparse(sheet);
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `availability-sheet-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function closeSync() {
    setPlan(null);
    setSheet(null);
    setFromPhoto(false);
  }

  async function applySync() {
    if (!sheet) return;
    setSyncing(true);
    setStage(STAGES.applying);
    const applied = await postJson<SyncPlan>(
      '/api/sync-staff-sheet',
      { rows: sheet, mode: 'apply', deleteMissing: removeMissing },
      { timeoutMs: 60_000 }
    );
    setSyncing(false);
    setStage(null);
    closeSync();

    if (!applied.ok || !applied.data) {
      alert(applied.error ?? 'The changes could not be applied.');
      load();
      return;
    }

    const result = applied.data;
    const a = result.applied;
    alert([
      a
        ? `Sheet synced — ${a.staff_created} added, ${a.staff_updated} detail change(s), ${a.staff_deleted} removed, ${a.availability_written} availability day(s) set, ${a.availability_cleared} cleared.`
        : 'Nothing was applied.',
      result.errors?.length ? `\n\nErrors:\n${result.errors.join('\n')}` : '',
    ].join(''));
    load();
  }

  const busy = stage !== null || syncing;
  const sheetRowCount = sheet ? sheet.length - 1 : 0;
  const filtered = staff.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-4">
      <ErrorBanner message={loadError} onRetry={load} />

      {stage && <ProgressBar stage={stage} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Staff</h1>
          <p className="text-sm text-slate-500">{staff.filter(s => s.active).length} active / {staff.length} total</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 w-full sm:w-auto">
          <input className="input w-full sm:w-48" placeholder="Search staff..." value={filter} onChange={e => setFilter(e.target.value)} />
          <div className="grid grid-cols-2 sm:flex gap-2">
            <button onClick={handleExport} className="btn-secondary justify-center"><Download size={14} /> Export CSV</button>
            <button onClick={() => cameraRef.current?.click()} disabled={busy} className="btn-secondary justify-center"><Camera size={14} /> Capture</button>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFilePicked} />
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn-secondary justify-center"><Upload size={14} /> Upload</button>
            <input ref={fileRef} type="file" accept="image/*,.csv,text/csv" className="hidden" onChange={handleFilePicked} />
            <button onClick={openAdd} className="btn-primary justify-center"><Plus size={16} /> Add Staff</button>
          </div>
        </div>
      </div>

      {loading ? <p className="text-slate-400">Loading...</p> : (
        <>
        {/* Phones: one card per person. The table needs more width than a phone has. */}
        <div className="md:hidden space-y-2">
          {filtered.map(s => (
            <div key={s.id} className={`card p-3 space-y-2.5 ${!s.active ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800 truncate">{s.name}</p>
                  {s.phone && <p className="text-xs text-slate-400">{s.phone}</p>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openEdit(s)} className="btn-ghost p-1.5" aria-label={`Edit ${s.name}`}><Pencil size={15} /></button>
                  <button onClick={() => remove(s)} className="btn-ghost p-1.5 text-red-500 hover:bg-red-50" aria-label={`Delete ${s.name}`}><Trash2 size={15} /></button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1">
                <span className={s.age_group === 'senior' ? 'badge-blue' : 'badge-amber'}>
                  {s.age_group === 'senior' ? 'Senior' : 'Junior'}
                </span>
                <span className={ROLE_BADGE[s.role_type]}>{ROLE_LABELS[s.role_type]}</span>
                <button onClick={() => toggleActive(s)} className={`badge cursor-pointer ${s.active ? 'badge-green' : 'badge-red'}`}>
                  {s.active ? <><UserCheck size={11} className="mr-1" />Active</> : <><UserX size={11} className="mr-1" />Inactive</>}
                </button>
              </div>

              {(s.staff_departments ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {(s.staff_departments ?? []).map(d => (
                    <span key={d.department_id} className="badge-slate text-xs">{d.departments?.name}</span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <DayStrip staffId={s.id} />
                <div className="w-28 shrink-0"><ReliabilityBar score={s.reliability_score} /></div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <p className="card text-center text-slate-400 py-8">No staff found.</p>}
        </div>

        <div className="hidden md:block card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Name', 'Type', 'Role', 'Departments', 'Availability', 'Reliability', 'Status', ''].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(s => (
                <tr key={s.id} className={`hover:bg-slate-50 transition-colors ${!s.active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 font-medium text-slate-800">{s.name}</td>
                  <td className="px-4 py-3">
                    <span className={s.age_group === 'senior' ? 'badge-blue' : 'badge-amber'}>
                      {s.age_group === 'senior' ? 'Senior' : 'Junior'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={ROLE_BADGE[s.role_type]}>{ROLE_LABELS[s.role_type]}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(s.staff_departments ?? []).map(d => (
                        <span key={d.department_id} className="badge-slate text-xs">{d.departments?.name}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <DayStrip staffId={s.id} />
                  </td>
                  <td className="px-4 py-3 min-w-[140px]">
                    <ReliabilityBar score={s.reliability_score} />
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleActive(s)} className={`badge ${s.active ? 'badge-green cursor-pointer' : 'badge-red cursor-pointer'}`}>
                      {s.active ? <><UserCheck size={11} className="mr-1" />Active</> : <><UserX size={11} className="mr-1" />Inactive</>}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(s)} className="btn-ghost p-1.5"><Pencil size={14} /></button>
                      <button onClick={() => remove(s)} className="btn-ghost p-1.5 text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {filtered.length === 0 && <p className="text-center text-slate-400 py-8">No staff found.</p>}
        </div>
        </>
      )}

      {modal && (
        <Modal title={modal === 'add' ? 'Add Staff Member' : `Edit ${editing?.name}`} onClose={() => setModal(null)} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label">Full Name</label>
                <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Sarah Jones" autoFocus />
              </div>
              <div>
                <label className="label">Age Group</label>
                <select className="input" value={form.age_group} onChange={e => setForm(f => ({ ...f, age_group: e.target.value as AgeGroup }))}>
                  <option value="senior">Senior (18+)</option>
                  <option value="junior">Junior (Under 18)</option>
                </select>
              </div>
              <div>
                <label className="label">Role Type</label>
                <select className="input" value={form.role_type} onChange={e => setForm(f => ({ ...f, role_type: e.target.value as RoleType }))}>
                  <option value="department_only">Department Only</option>
                  <option value="potential_all_rounder">Potential All Rounder</option>
                  <option value="all_rounder">All Rounder</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="label">Phone (optional)</label>
                <input className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+44 7700 000000" />
              </div>
            </div>

            <div>
              <label className="label">Trained Departments</label>
              <div className="grid grid-cols-2 gap-2">
                {departments.map(d => {
                  const assigned = form.selectedDepts.find(sd => sd.department_id === d.id);
                  return (
                    <div key={d.id} className={`rounded-lg border p-2.5 cursor-pointer transition-colors ${assigned ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`} onClick={() => toggleDept(d.id)}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-700">{d.name}</span>
                        <input type="checkbox" checked={!!assigned} readOnly className="accent-blue-600" />
                      </div>
                      {assigned && (
                        <select className="input mt-2 text-xs py-1" value={assigned.training_level} onClick={e => e.stopPropagation()} onChange={e => setTrainingLevel(d.id, e.target.value as TrainingLevel)}>
                          <option value="supervised">Supervised</option>
                          <option value="trained">Trained</option>
                          <option value="advanced">Advanced</option>
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="label">Weekly Availability</label>
              <p className="text-xs text-slate-400 mb-2">
                Uploading a new availability sheet overwrites these hours.
              </p>
              <div className="space-y-1.5">
                {DAYS.map((day, i) => {
                  const t = form.availability[i];
                  return (
                    <div key={day} className={`rounded-lg border p-2 transition-colors ${t.available ? 'border-blue-200 bg-blue-50/40' : 'border-slate-200'}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-2 w-28 shrink-0 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={t.available}
                            onChange={e => setDay(i, { available: e.target.checked })}
                            className="w-4 h-4 accent-blue-600"
                          />
                          <span className={`text-sm font-medium ${t.available ? 'text-blue-800' : 'text-slate-400'}`}>{day}</span>
                        </label>
                        {t.available && (
                          <div className="flex items-center gap-1.5">
                            <input type="time" className="input w-auto py-1 text-sm" value={t.start_time}
                              onChange={e => setDay(i, { start_time: e.target.value })} />
                            <span className="text-slate-400 text-sm">to</span>
                            <input type="time" className="input w-auto py-1 text-sm" value={t.end_time}
                              onChange={e => setDay(i, { end_time: e.target.value })} />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModal(null)} className="btn-secondary">Cancel</button>
              <button onClick={save} className="btn-primary">Save</button>
            </div>
          </div>
        </Modal>
      )}

      {plan && (
        <Modal title={fromPhoto ? 'Sync from Photo' : 'Sync Availability Sheet'} onClose={closeSync} size="lg">
          <div className="space-y-4 text-sm">
            {fromPhoto && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs text-amber-800">
                  Read from a photo. Check the names, mobile numbers and times below against the sheet before applying —
                  anything that could not be read clearly was left unchanged.
                </p>
              </div>
            )}

            {plan.layout && <p className="text-xs text-slate-400">Columns read — {plan.layout}</p>}

            <div className="flex flex-wrap gap-1.5">
              <span className="badge-green">{plan.creates.length} new</span>
              <span className="badge-blue">{plan.updates.length} changed</span>
              <span className="badge-slate">{plan.unchanged.length} unchanged</span>
              {plan.deletes.length > 0 && <span className="badge-red">{plan.deletes.length} no longer listed</span>}
            </div>

            {plan.errors.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-1">
                {plan.errors.map((err, i) => <p key={i} className="text-xs text-red-700">{err}</p>)}
              </div>
            )}

            {plan.creates.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">New staff</h3>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {plan.creates.map(c => (
                    <li key={c.name} className="px-3 py-2 flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-700">{c.name}</span>
                      <span className="text-xs text-slate-400">
                        {c.phone ?? 'no mobile'} · {c.age_group === 'junior' ? 'Junior' : 'Senior'} · {c.available_days} day{c.available_days === 1 ? '' : 's'} available
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {plan.updates.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Changes</h3>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {plan.updates.map(u => (
                    <li key={u.id} className="px-3 py-2">
                      <p className="font-medium text-slate-700">{u.name}</p>
                      <ul className="mt-0.5 space-y-0.5">
                        {u.changes.map((c, i) => (
                          <li key={i} className="text-xs text-slate-500">
                            {c.field}: <span className="text-slate-400 line-through">{c.from ?? 'not set'}</span>
                            {' → '}
                            <span className="text-slate-700">{c.to ?? 'unavailable'}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {plan.deletes.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Not on this sheet</h3>
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                  <p className="text-xs text-red-700">
                    {plan.deletes.map(d => d.name).join(', ')}
                  </p>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" checked={removeMissing} onChange={e => setRemoveMissing(e.target.checked)} className="mt-0.5 accent-red-600" />
                    <span className="text-xs text-red-800">
                      Delete these {plan.deletes.length} staff member(s) and their availability, shifts history and department assignments. This cannot be undone.
                    </span>
                  </label>
                </div>
              </section>
            )}

            {plan.warnings.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Needs a look</h3>
                <ul className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
                  {plan.warnings.map((w, i) => <li key={i} className="text-xs text-amber-800">{w}</li>)}
                </ul>
              </section>
            )}

            {plan.unchanged.length > 0 && (
              <details className="rounded-lg border border-slate-200">
                <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  {plan.unchanged.length} already up to date
                </summary>
                <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">{plan.unchanged.join(', ')}</p>
              </details>
            )}

            {sheet && (
              <details className="rounded-lg border border-slate-200">
                <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  {sheetRowCount} row{sheetRowCount === 1 ? '' : 's'} read from the {fromPhoto ? 'photo' : 'file'}
                  {scanSeconds !== null && ` in ${scanSeconds}s`}
                  <span className="ml-1 font-normal normal-case text-slate-400">— open to check</span>
                </summary>
                <div className="border-t border-slate-100 p-3 space-y-3">
                  <button onClick={downloadSheetCsv} className="btn-secondary text-xs">
                    <FileSpreadsheet size={13} /> Download as CSV
                  </button>
                  <div className="overflow-x-auto">
                    <table className="text-xs whitespace-nowrap">
                      <thead>
                        <tr className="text-slate-400">
                          {['First', 'Last', 'Mobile', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(h => (
                            <th key={h} className="px-2 py-1 text-left font-semibold">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sheet.slice(1).map((row, i) => (
                          <tr key={i} className="text-slate-600">
                            {Array.from({ length: 10 }, (_, col) => (
                              <td key={col} className="px-2 py-1">{row[col] ?? ''}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            )}

            {plan.creates.length === 0 && plan.updates.length === 0 && plan.deletes.length === 0 && (
              <p className="text-slate-500">Everything already matches this sheet — nothing to change.</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={closeSync} className="btn-secondary">Cancel</button>
              <button
                onClick={applySync}
                disabled={syncing || (plan.creates.length === 0 && plan.updates.length === 0 && (plan.deletes.length === 0 || !removeMissing))}
                className="btn-primary"
              >
                {syncing ? 'Applying...' : 'Apply to Staff List'}
              </button>
            </div>
          </div>
        </Modal>
      )}

    </div>
  );
}
