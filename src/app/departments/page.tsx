'use client';

import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, ShieldCheck, Users } from 'lucide-react';
import ErrorBanner from '@/components/ErrorBanner';
import Modal from '@/components/Modal';
import { Department, Staff, TrainingLevel } from '@/lib/types';
import { fetchList } from '@/lib/api';

const TRAINING_LABELS: Record<TrainingLevel, string> = {
  supervised: 'Supervised',
  trained: 'Trained',
  advanced: 'Advanced',
};

const TRAINING_BADGE: Record<TrainingLevel, string> = {
  supervised: 'badge-amber',
  trained: 'badge-slate',
  advanced: 'badge-green',
};

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [modal, setModal] = useState<'add' | 'edit' | null>(null);
  const [viewing, setViewing] = useState<Department | null>(null);
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState({ name: '', requires_supervisor: false });

  async function load() {
    const [deptRes, staffRes] = await Promise.all([
      fetchList<Department>('/api/departments'),
      fetchList<Staff>('/api/staff'),
    ]);
    setDepartments(deptRes.data);
    setStaff(staffRes.data);
    setLoadError(deptRes.error ?? staffRes.error);
    setLoading(false);
  }

  /** Everyone trained in a department, with how far their training goes. */
  function trainedIn(departmentId: string): { staff: Staff; level: TrainingLevel }[] {
    return staff
      .flatMap(s => {
        const assignment = (s.staff_departments ?? []).find(d => d.department_id === departmentId);
        return assignment ? [{ staff: s, level: (assignment.training_level ?? 'trained') as TrainingLevel }] : [];
      })
      .sort((a, b) => a.staff.name.localeCompare(b.staff.name));
  }

  useEffect(() => { load(); }, []);

  function openAdd() {
    setForm({ name: '', requires_supervisor: false });
    setModal('add');
  }

  function openEdit(d: Department) {
    setEditing(d);
    setForm({ name: d.name, requires_supervisor: d.requires_supervisor });
    setModal('edit');
  }

  async function save() {
    if (!form.name.trim()) return;
    if (modal === 'add') {
      await fetch('/api/departments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    } else if (editing) {
      await fetch(`/api/departments/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    }
    setModal(null);
    load();
  }

  async function remove(d: Department) {
    if (!confirm(`Delete department "${d.name}"? This will remove all staff assignments for this department.`)) return;
    await fetch(`/api/departments/${d.id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="space-y-4">
      <ErrorBanner message={loadError} onRetry={load} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Departments</h1>
          <p className="text-sm text-slate-500">{departments.length} departments</p>
        </div>
        <button onClick={openAdd} className="btn-primary">
          <Plus size={16} /> Add Department
        </button>
      </div>

      {loading ? (
        <p className="text-slate-400">Loading...</p>
      ) : departments.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">
          <p>No departments yet. Add your first one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {departments.map(d => (
            <div key={d.id} className="card p-4 flex items-start justify-between gap-2">
              <button onClick={() => setViewing(d)} className="text-left min-w-0 flex-1 group">
                <p className="font-semibold text-slate-800 group-hover:text-blue-700">{d.name}</p>
                <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                  <Users size={12} />
                  {trainedIn(d.id).length} trained
                </p>
                {d.requires_supervisor && (
                  <span className="badge-amber mt-1.5">
                    <ShieldCheck size={11} className="mr-1" /> Supervisor required
                  </span>
                )}
              </button>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => openEdit(d)} className="btn-ghost p-1.5" aria-label={`Edit ${d.name}`}><Pencil size={14} /></button>
                <button onClick={() => remove(d)} className="btn-ghost p-1.5 text-red-500 hover:bg-red-50" aria-label={`Delete ${d.name}`}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewing && (
        <Modal title={`${viewing.name} — trained staff`} onClose={() => setViewing(null)}>
          <div className="space-y-3">
            {trainedIn(viewing.id).length === 0 ? (
              <p className="text-slate-500 text-sm">
                Nobody is trained in {viewing.name} yet. Add the department to someone on the Staff page.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {trainedIn(viewing.id).map(({ staff: s, level }) => (
                  <li key={s.id} className={`px-3 py-2.5 flex items-center justify-between gap-2 ${s.active ? '' : 'opacity-50'}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{s.name}</p>
                      <p className="text-xs text-slate-400">
                        {s.age_group === 'senior' ? 'Senior' : 'Junior'}{s.active ? '' : ' · inactive'}
                      </p>
                    </div>
                    <span className={`shrink-0 ${TRAINING_BADGE[level]}`}>{TRAINING_LABELS[level]}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <button onClick={() => setViewing(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        </Modal>
      )}

      {modal && (
        <Modal title={modal === 'add' ? 'Add Department' : 'Edit Department'} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <div>
              <label className="label">Department Name</label>
              <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Bakery, Produce, Checkout..." autoFocus />
            </div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={form.requires_supervisor} onChange={e => setForm(f => ({ ...f, requires_supervisor: e.target.checked }))} className="w-4 h-4 accent-blue-600" />
              <div>
                <p className="text-sm font-medium text-slate-700">Requires Supervisor</p>
                <p className="text-xs text-slate-400">Juniors cannot work here alone without a senior on shift</p>
              </div>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModal(null)} className="btn-secondary">Cancel</button>
              <button onClick={save} className="btn-primary">Save</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
