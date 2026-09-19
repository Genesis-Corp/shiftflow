'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Pencil, Trash2, ShieldCheck, ChevronDown, Users, Star, Ban } from 'lucide-react';
import Modal from '@/components/Modal';
import ErrorBanner from '@/components/ErrorBanner';
import ReliabilityBar from '@/components/ReliabilityBar';
import { fetchJson } from '@/lib/apiClient';
import { Department, Staff, AvailabilityTemplate } from '@/lib/types';
import { DAY_SHORT } from '@/lib/shiftUtils';
import { PRESET_DEPARTMENT_COLORS, normalizeDeptColor, autoDeptColor } from '@/lib/deptColors';

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [availability, setAvailability] = useState<AvailabilityTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState<'add' | 'edit' | null>(null);
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState<{ name: string; requires_supervisor: boolean; excluded_from_claim_race: boolean; color: string }>({
    name: '', requires_supervisor: false, excluded_from_claim_race: false, color: PRESET_DEPARTMENT_COLORS[0],
  });
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [deptData, staffData, availData] = await Promise.all([
        fetchJson<Department[]>('/api/departments'),
        fetchJson<Staff[]>('/api/staff'),
        fetchJson<AvailabilityTemplate[]>('/api/availability'),
      ]);
      setDepartments(deptData);
      setStaff(staffData);
      setAvailability(availData);
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load departments');
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Which days (0=Sun..6=Sat) each staff member is available, per their
  // availability template — a day with no row, or one marked unavailable,
  // reads the same as the Availability page itself: not available.
  const availableDaysByStaff = useMemo(() => {
    const map = new Map<string, Set<number>>();
    for (const a of availability) {
      if (!a.available) continue;
      if (!map.has(a.staff_id)) map.set(a.staff_id, new Set());
      map.get(a.staff_id)!.add(a.day_of_week);
    }
    return map;
  }, [availability]);

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
    const used = new Set(departments.map(d => normalizeDeptColor(d.color)));
    const next = PRESET_DEPARTMENT_COLORS.find(c => !used.has(c)) ?? autoDeptColor(departments.length);
    setForm({ name: '', requires_supervisor: false, excluded_from_claim_race: false, color: next });
    setModal('add');
  }

  function openEdit(d: Department) {
    setEditing(d);
    setForm({
      name: d.name, requires_supervisor: d.requires_supervisor,
      excluded_from_claim_race: d.excluded_from_claim_race, color: normalizeDeptColor(d.color),
    });
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

  async function setDefault(d: Department) {
    await fetch(`/api/departments/${d.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_default: !d.is_default }),
    });
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
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: normalizeDeptColor(d.color) }} />
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
                      {d.excluded_from_claim_race && (
                        <span className="badge-slate">
                          <Ban size={11} className="mr-1" /> Excluded from claim race
                        </span>
                      )}
                      {d.is_default && (
                        <span className="badge-blue">
                          <Star size={11} className="mr-1" /> Default
                        </span>
                      )}
                    </div>
                  </button>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => setDefault(d)}
                      title={d.is_default ? 'Unset as default department' : 'Set as default department for new staff'}
                      className={`btn-ghost p-1.5 ${d.is_default ? 'text-amber-500' : ''}`}
                    >
                      <Star size={14} fill={d.is_default ? 'currentColor' : 'none'} />
                    </button>
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
                        {assigned.map(s => {
                          const availableDays = availableDaysByStaff.get(s.id);
                          return (
                            <li key={s.id} className={`px-4 py-2 space-y-1.5 ${!s.active ? 'opacity-50' : ''}`}>
                              <div className="flex items-center justify-between gap-2">
                                <Link
                                  href={`/staff?edit=${s.id}`}
                                  className="text-sm text-slate-700 truncate hover:text-blue-600 hover:underline"
                                >
                                  {s.name}
                                </Link>
                                <div className="w-16 shrink-0"><ReliabilityBar score={s.reliability_score} showLabel={false} /></div>
                              </div>
                              <div className="flex items-center justify-between">
                                {DAY_SHORT.map((day, i) => {
                                  const available = availableDays?.has(i) ?? false;
                                  return (
                                    <div key={day} className="flex flex-col items-center gap-0.5" title={`${day}: ${available ? 'Available' : 'Not available'}`}>
                                      <span className={`w-1.5 h-1.5 rounded-full ${available ? 'bg-green-500' : 'bg-red-400'}`} />
                                      <span className="text-[9px] leading-none text-slate-400">{day}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </li>
                          );
                        })}
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
            <div>
              <label className="label">Color</label>
              <div className="flex flex-wrap items-center gap-2">
                {PRESET_DEPARTMENT_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, color: c }))}
                    title={c}
                    style={{ backgroundColor: c }}
                    className={`w-7 h-7 rounded-full ${
                      normalizeDeptColor(form.color) === c ? 'ring-2 ring-offset-2 ring-slate-400' : ''
                    }`}
                  />
                ))}
                <label
                  title="Pick a custom color"
                  className="w-7 h-7 rounded-full border-2 border-dashed border-slate-300 flex items-center justify-center cursor-pointer overflow-hidden relative"
                  style={{ backgroundColor: PRESET_DEPARTMENT_COLORS.includes(normalizeDeptColor(form.color)) ? undefined : normalizeDeptColor(form.color) }}
                >
                  {PRESET_DEPARTMENT_COLORS.includes(normalizeDeptColor(form.color)) && (
                    <Plus size={14} className="text-slate-400" />
                  )}
                  <input
                    type="color"
                    value={normalizeDeptColor(form.color)}
                    onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </label>
                <input
                  type="text"
                  value={normalizeDeptColor(form.color)}
                  onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                  className="input w-24 font-mono text-xs py-1.5"
                  placeholder="#3b82f6"
                  maxLength={7}
                />
              </div>
            </div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={form.requires_supervisor} onChange={e => setForm(f => ({ ...f, requires_supervisor: e.target.checked }))} className="w-4 h-4 accent-blue-600" />
              <div>
                <p className="text-sm font-medium text-slate-700">Requires Supervisor</p>
                <p className="text-xs text-slate-400">Juniors cannot work here alone without a senior on shift</p>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={form.excluded_from_claim_race} onChange={e => setForm(f => ({ ...f, excluded_from_claim_race: e.target.checked }))} className="w-4 h-4 accent-blue-600" />
              <div>
                <p className="text-sm font-medium text-slate-700">Excluded from Claim Race</p>
                <p className="text-xs text-slate-400">Won&apos;t appear in the Department picker when a manager starts a claim race on Cover Shift</p>
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
