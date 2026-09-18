'use client';

import { useEffect, useState } from 'react';
import {
  Plus, Pencil, Trash2, Download, UserCheck, UserX, ChevronUp, ChevronDown, ChevronsUpDown,
  Camera, FileText, FileSpreadsheet,
} from 'lucide-react';
import Modal from '@/components/Modal';
import ReliabilityBar from '@/components/ReliabilityBar';
import ErrorBanner from '@/components/ErrorBanner';
import UploadMenu from '@/components/UploadMenu';
import DropOverlay from '@/components/DropOverlay';
import { useFileDrop } from '@/lib/useFileDrop';
import ProgressBar, { ProgressStage } from '@/components/ProgressBar';
import { STAGES } from '@/lib/progressStages';
import { fetchJson } from '@/lib/apiClient';
import { postJson } from '@/lib/api';
import { downscalePhoto } from '@/lib/image';
import { readPdfAsBase64 } from '@/lib/pdf';
import { isAvailabilitySheet, matrixToObjects } from '@/lib/availabilitySheet';
import type { SyncPlan } from '@/lib/staffSync';
import { Staff, Department, RoleType, AgeGroup, TrainingLevel } from '@/lib/types';
import Papa from 'papaparse';

const ROLE_LABELS: Record<RoleType, string> = {
  department_only: 'Department Only',
  all_rounder: 'All Rounder',
  potential_all_rounder: 'Potential All Rounder',
};

const ROLE_BADGE: Record<RoleType, string> = {
  department_only: 'badge-slate',
  all_rounder: 'badge-green',
  potential_all_rounder: 'badge-blue',
};

type SortKey = 'name' | 'age_group' | 'role_type' | 'departments' | 'reliability_score' | 'active';

/** First click on a column sorts the way you'd actually want to read it:
 *  names A-Z, but reliability highest-first, not 0 first. */
const DEFAULT_SORT_DIR: Record<SortKey, 'asc' | 'desc'> = {
  name: 'asc', age_group: 'asc', role_type: 'asc',
  departments: 'desc', reliability_score: 'desc', active: 'desc',
};

function sortValue(s: Staff, key: SortKey): string | number {
  switch (key) {
    case 'name': return s.name.toLowerCase();
    case 'age_group': return s.age_group;
    case 'role_type': return s.role_type;
    case 'departments': return (s.staff_departments ?? []).length;
    case 'reliability_score': return s.reliability_score;
    case 'active': return s.active ? 1 : 0;
  }
}

function SortableHeader({ label, sortKey, active, dir, onClick }: {
  label: string; sortKey: SortKey; active: boolean; dir: 'asc' | 'desc'; onClick: (key: SortKey) => void;
}) {
  return (
    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
      <button onClick={() => onClick(sortKey)} className="flex items-center gap-1 hover:text-slate-700 transition-colors">
        {label}
        {active
          ? (dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
          : <ChevronsUpDown size={12} className="text-slate-300" />}
      </button>
    </th>
  );
}

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState<'add' | 'edit' | null>(null);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Availability-sheet sync: the uploaded grid, the preview of what it changes,
  // and whether staff missing from it should be removed.
  const [sheet, setSheet] = useState<string[][] | null>(null);
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [removeMissing, setRemoveMissing] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [stage, setStage] = useState<ProgressStage | null>(null);
  const [fromPhoto, setFromPhoto] = useState(false);
  const [scanSeconds, setScanSeconds] = useState<number | null>(null);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(DEFAULT_SORT_DIR[key]);
    }
  }

  const [form, setForm] = useState({
    name: '', age_group: 'senior' as AgeGroup, role_type: 'department_only' as RoleType, phone: '',
    selectedDepts: [] as { department_id: string; training_level: TrainingLevel }[],
  });

  async function load() {
    setLoading(true);
    try {
      const [staffData, deptData] = await Promise.all([
        fetchJson<Staff[]>('/api/staff'),
        fetchJson<Department[]>('/api/departments'),
      ]);
      setStaff(staffData);
      setDepartments(deptData);
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load staff');
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openAdd() {
    setEditing(null);
    setForm({ name: '', age_group: 'senior', role_type: 'department_only', phone: '', selectedDepts: [] });
    setModal('add');
  }

  function openEdit(s: Staff) {
    setEditing(s);
    const depts = (s.staff_departments ?? []).map(d => ({
      department_id: d.department_id,
      training_level: (d.training_level ?? 'trained') as TrainingLevel,
    }));
    setForm({ name: s.name, age_group: s.age_group, role_type: s.role_type, phone: s.phone ?? '', selectedDepts: depts });
    setModal('edit');
  }

  function toggleDept(dept_id: string) {
    setForm(f => {
      const exists = f.selectedDepts.find(d => d.department_id === dept_id);
      if (exists) return { ...f, selectedDepts: f.selectedDepts.filter(d => d.department_id !== dept_id) };
      return { ...f, selectedDepts: [...f.selectedDepts, { department_id: dept_id, training_level: 'trained' }] };
    });
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
   * was used, a photo or PDF is transcribed and a CSV is parsed — picking a
   * photo here used to fall through to the plain staff importer, which
   * quietly did nothing.
   */
  function handleFilePicked(file: File) {
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
    if (file.type === 'application/pdf' || /\.pdf$/.test(name)) {
      readPdfFile(file);
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

  /** Same flow as readPhoto, for a PDF export of the sheet instead of a photo. */
  async function readPdfFile(file: File) {
    try {
      setStage(STAGES.preparingPdf);
      const pdf = await readPdfAsBase64(file);

      setStage(STAGES.readingPdf);
      const scan = await postJson<{ rows: string[][]; seconds?: number }>(
        '/api/scan-sheet',
        { pdf },
        { timeoutMs: 70_000 }
      );
      if (!scan.ok || !scan.data) { alert(scan.error ?? 'Could not read that PDF.'); return; }

      setStage(STAGES.comparing);
      const preview = await postJson<SyncPlan>('/api/sync-staff-sheet', { rows: scan.data.rows, mode: 'preview' }, { timeoutMs: 60_000 });
      if (!preview.ok || !preview.data) { alert(preview.error ?? 'Could not read that PDF as an availability sheet.'); return; }

      setSheet(scan.data.rows);
      setRemoveMissing(true);
      setFromPhoto(false);
      setScanSeconds(scan.data.seconds ?? null);
      setPlan(preview.data);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not read that PDF.');
    } finally {
      setStage(null);
    }
  }

  /**
   * The sheet as it was read, as a CSV. For a photo or PDF this is the
   * converted spreadsheet — worth keeping, and openable in Excel or Google
   * Sheets to fix anything the read got wrong before re-uploading it.
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

  const sorted = sortKey
    ? [...filtered].sort((a, b) => {
        const av = sortValue(a, sortKey), bv = sortValue(b, sortKey);
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv));
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : filtered;

  const { dragging, dropHandlers } = useFileDrop(files => {
    for (const file of files) handleFilePicked(file);
  }, busy);

  return (
    <div className="space-y-4" {...dropHandlers}>
      <DropOverlay active={dragging} label="Drop a staff photo, PDF or CSV to import" />
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
            <UploadMenu
              disabled={busy}
              options={[
                {
                  key: 'capture',
                  label: 'Capture',
                  icon: <Camera size={14} />,
                  accept: 'image/*',
                  capture: 'environment',
                  onChange: e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) handleFilePicked(file); },
                },
                {
                  key: 'upload',
                  label: 'Upload',
                  icon: <FileText size={14} />,
                  accept: 'image/*,.csv,text/csv',
                  onChange: e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) handleFilePicked(file); },
                },
                {
                  key: 'pdf',
                  label: 'Upload PDF',
                  icon: <FileSpreadsheet size={14} />,
                  accept: 'application/pdf',
                  onChange: e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) handleFilePicked(file); },
                },
              ]}
            />
            <button onClick={openAdd} className="btn-primary justify-center col-span-2 sm:col-auto"><Plus size={16} /> Add Staff</button>
          </div>
        </div>
      </div>

      {loadError && <ErrorBanner message={loadError} onRetry={load} />}

      {loading ? <p className="text-slate-400">Loading...</p> : loadError ? null : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <SortableHeader label="Name" sortKey="name" active={sortKey === 'name'} dir={sortDir} onClick={toggleSort} />
                <SortableHeader label="Type" sortKey="age_group" active={sortKey === 'age_group'} dir={sortDir} onClick={toggleSort} />
                <SortableHeader label="Role" sortKey="role_type" active={sortKey === 'role_type'} dir={sortDir} onClick={toggleSort} />
                <SortableHeader label="Departments" sortKey="departments" active={sortKey === 'departments'} dir={sortDir} onClick={toggleSort} />
                <SortableHeader label="Reliability" sortKey="reliability_score" active={sortKey === 'reliability_score'} dir={sortDir} onClick={toggleSort} />
                <SortableHeader label="Status" sortKey="active" active={sortKey === 'active'} dir={sortDir} onClick={toggleSort} />
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map(s => (
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
          {sorted.length === 0 && <p className="text-center text-slate-400 py-8">No staff found.</p>}
        </div>
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
