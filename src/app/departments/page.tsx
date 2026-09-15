'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, ShieldCheck, ChevronDown, Users } from 'lucide-react';
import Modal from '@/components/Modal';
import ErrorBanner from '@/components/ErrorBanner';
import ReliabilityBar from '@/components/ReliabilityBar';
import { fetchJson } from '@/lib/apiClient';
import { Department, Staff } from '@/lib/types';

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState<'add' | 'edit' | null>(null);
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState({ name: '', requires_supervisor: false });
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [deptData, staffData] = await Promise.all([
        fetchJson<Department[]>('/api/departments'),
        fetchJson<Staff[]>('/api/staff'),
      ]);
      setDepartments(deptData);
      setStaff(staffData);
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load departments');
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Who's assigned to each department, sorted by name — looked up once per
  // load rather than filtered fresh on every render/expand.
  const staffByDept = useMemo(() => {
    const map = new Map<string, Staff[]>();
    for (const s of staff) {
      for (const sd of s.staff_departments ?? []) {
        map.set(sd.department_id, [...(map.get(sd.department_id) ?? []), s]);
      }
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [staff]);

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Departments</h1>
          <p className="text-sm text-slate-500">{departments.length} departments</p>
        </div>
        <button onClick={openAdd} className="btn-primary">
          <Plus size={16} /> Add Department
        </button>
      </div>

      {loadError && <ErrorBanner message={loadError} onRetry={load} />}

      {loading ? (
        <p className="text-slate-400">Loading...</p>
      ) : loadError ? null : departments.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">
          <p>No departments yet. Add your first one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {departments.map(d => {
            const assigned = staffByDept.get(d.id) ?? [];
            const isOpen = expanded === d.id;
            return (
              <div key={d.id} className="card overflow-hidden">
                <div className="p-4 flex items-start justify-between gap-2">
                  <button
                    onClick={() => setExpanded(isOpen ? null : d.id)}
                    className="flex-1 min-w-0 text-left"
                    aria-expanded={isOpen}
                  >
                    <div className="flex items-center gap-1.5">
                      <p className="font-semibold text-slate-800 truncate">{d.name}</p>
                      <ChevronDown size={14} className={`text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className="badge-slate">
                        <Users size={11} className="mr-1" /> {assigned.length} staff
                      </span>
                      {d.requires_supervisor && (
                        <span className="badge-amber">
                          <ShieldCheck size={11} className="mr-1" /> Supervisor required
                        </span>
                      )}
                    </div>
                  </button>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEdit(d)} className="btn-ghost p-1.5"><Pencil size={14} /></button>
                    <button onClick={() => remove(d)} className="btn-ghost p-1.5 text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-slate-100">
                    {assigned.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-slate-400">No staff assigned to this department.</p>
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {assigned.map(s => (
                          <li key={s.id} className={`px-4 py-2 flex items-center justify-between gap-2 ${!s.active ? 'opacity-50' : ''}`}>
                            <span className="text-sm text-slate-700 truncate">{s.name}</span>
                            <div className="w-16 shrink-0"><ReliabilityBar score={s.reliability_score} showLabel={false} /></div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
