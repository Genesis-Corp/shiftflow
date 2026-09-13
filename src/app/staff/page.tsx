'use client';

import { useEffect, useState, useRef } from 'react';
import { Plus, Pencil, Trash2, Upload, Download, UserCheck, UserX } from 'lucide-react';
import Modal from '@/components/Modal';
import ReliabilityBar from '@/components/ReliabilityBar';
import { Staff, Department, RoleType, AgeGroup, TrainingLevel } from '@/lib/types';
import { isAvailabilitySheet, matrixToObjects } from '@/lib/availabilitySheet';
import type { SyncPlan } from '@/lib/staffSync';
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

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<'add' | 'edit' | null>(null);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [filter, setFilter] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Availability-sheet sync: the uploaded grid, the preview of what it changes,
  // and whether staff missing from it should be removed.
  const [sheet, setSheet] = useState<string[][] | null>(null);
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [removeMissing, setRemoveMissing] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [form, setForm] = useState({
    name: '', age_group: 'senior' as AgeGroup, role_type: 'department_only' as RoleType, phone: '',
    selectedDepts: [] as { department_id: string; training_level: TrainingLevel }[],
  });

  async function load() {
    const [sRes, dRes] = await Promise.all([fetch('/api/staff'), fetch('/api/departments')]);
    setStaff(await sRes.json());
    setDepartments(await dRes.json());
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
   * Availability sheets are synced (preview first, then apply); any other CSV
   * goes through the plain importer. The sheet is read as a raw grid because
   * its NAME header spans two columns and it carries section banner rows.
   */
  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be picked again after a fix
    if (!file) return;

    Papa.parse<string[]>(file, {
      skipEmptyLines: 'greedy',
      complete: async (results) => {
        const rows = results.data;

        if (isAvailabilitySheet(rows)) {
          setSyncing(true);
          const res = await fetch('/api/sync-staff-sheet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows, mode: 'preview' }),
          });
          const preview = await res.json();
          setSyncing(false);
          if (!res.ok) { alert(preview.error ?? 'Could not read that sheet.'); return; }
          setSheet(rows);
          setRemoveMissing(true);
          setPlan(preview);
          return;
        }

        const res = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: matrixToObjects(rows) }),
        });
        const data = await res.json();
        alert(`Imported ${data.created} staff. ${data.errors?.length ? `Errors: ${data.errors.join(', ')}` : ''}`);
        load();
      }
    });
  }

  function closeSync() {
    setPlan(null);
    setSheet(null);
  }

  async function applySync() {
    if (!sheet) return;
    setSyncing(true);
    const res = await fetch('/api/sync-staff-sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: sheet, mode: 'apply', deleteMissing: removeMissing }),
    });
    const result: SyncPlan = await res.json();
    setSyncing(false);
    closeSync();

    const a = result.applied;
    alert([
      a
        ? `Sheet synced — ${a.staff_created} added, ${a.staff_updated} detail change(s), ${a.staff_deleted} removed, ${a.availability_written} availability day(s) set, ${a.availability_cleared} cleared.`
        : 'Nothing was applied.',
      result.errors?.length ? `\n\nErrors:\n${result.errors.join('\n')}` : '',
    ].join(''));
    load();
  }

  const filtered = staff.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Staff</h1>
          <p className="text-sm text-slate-500">{staff.filter(s => s.active).length} active / {staff.length} total</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input className="input w-48" placeholder="Search staff..." value={filter} onChange={e => setFilter(e.target.value)} />
          <button onClick={handleExport} className="btn-secondary"><Download size={14} /> Export CSV</button>
          <button onClick={() => fileRef.current?.click()} disabled={syncing} className="btn-secondary"><Upload size={14} /> {syncing ? 'Reading sheet...' : 'Import / Sync Sheet'}</button>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleImportFile} />
          <button onClick={openAdd} className="btn-primary"><Plus size={16} /> Add Staff</button>
        </div>
      </div>

      {loading ? <p className="text-slate-400">Loading...</p> : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Name', 'Type', 'Role', 'Departments', 'Reliability', 'Status', ''].map(h => (
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
          {filtered.length === 0 && <p className="text-center text-slate-400 py-8">No staff found.</p>}
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
        <Modal title="Sync Availability Sheet" onClose={closeSync} size="lg">
          <div className="space-y-4 text-sm">
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
