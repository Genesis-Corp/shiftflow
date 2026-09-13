'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, Coffee, Download, Upload } from 'lucide-react';
import ErrorBanner from '@/components/ErrorBanner';
import Modal from '@/components/Modal';
import { Shift, Department } from '@/lib/types';
import { fetchList } from '@/lib/api';
import { formatDate, formatDuration, requiresBreak, BREAK_DURATION_MINUTES } from '@/lib/shiftUtils';
import Papa from 'papaparse';

const STATUS_BADGE: Record<string, string> = {
  open: 'badge-red',
  covered: 'badge-green',
  cancelled: 'badge-slate',
};

export default function ShiftsPage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modal, setModal] = useState<'add' | 'edit' | 'adjust' | null>(null);
  const [editing, setEditing] = useState<Shift | null>(null);
  const [dateFilter, setDateFilter] = useState('');

  const [form, setForm] = useState({
    date: '', start_time: '09:00', end_time: '17:00',
    department_id: '', required_role: 'any', notes: '',
  });

  const [adjustForm, setAdjustForm] = useState({ start_time: '', end_time: '' });
  const importRef = useRef<HTMLInputElement>(null);

  async function load() {
    const [shiftRes, deptRes] = await Promise.all([
      fetchList<Shift>(`/api/shifts${dateFilter ? `?date=${dateFilter}` : ''}`),
      fetchList<Department>('/api/departments'),
    ]);
    setShifts(shiftRes.data);
    setDepartments(deptRes.data);
    setLoadError(shiftRes.error ?? deptRes.error);
    setLoading(false);
  }

  useEffect(() => { load(); }, [dateFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  function openAdd() {
    setForm({ date: new Date().toISOString().split('T')[0], start_time: '09:00', end_time: '17:00', department_id: departments[0]?.id ?? '', required_role: 'any', notes: '' });
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

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

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

  return (
    <div className="space-y-4">
      <ErrorBanner message={loadError} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Shifts</h1>
          <p className="text-sm text-slate-500">{shifts.length} shifts {dateFilter ? `on ${formatDate(dateFilter)}` : 'total'}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input type="date" className="input w-auto" value={dateFilter} onChange={e => setDateFilter(e.target.value)} />
          {dateFilter && <button onClick={() => setDateFilter('')} className="btn-secondary text-xs">Clear date</button>}
          <input ref={importRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
          <button onClick={() => importRef.current?.click()} className="btn-secondary"><Upload size={14} /> Import CSV</button>
          <button onClick={handleExport} className="btn-secondary"><Download size={14} /> Export</button>
          <button onClick={openAdd} className="btn-primary"><Plus size={16} /> Add Shift</button>
        </div>
      </div>

      {loading ? <p className="text-slate-400">Loading...</p> : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Date', 'Time', 'Duration', 'Department', 'Role', 'Break', 'Status', 'Assigned', ''].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shifts.map(s => (
                <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-slate-700">{formatDate(s.date)}</td>
                  <td className="px-4 py-3 font-mono text-slate-800">{s.start_time} – {s.end_time}</td>
                  <td className="px-4 py-3 text-slate-500">{formatDuration(s.start_time, s.end_time)}</td>
                  <td className="px-4 py-3 text-slate-700">{s.departments?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="badge-slate capitalize">{s.required_role}</span>
                  </td>
                  <td className="px-4 py-3">
                    {s.has_break ? <span className="badge-amber"><Coffee size={11} className="mr-1" />{s.break_duration_minutes}m</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={STATUS_BADGE[s.status] ?? 'badge-slate'}>{s.status}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{(s as {assigned_staff?: {name: string}}).assigned_staff?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => openAdjust(s)} title="Adjust times" className="btn-ghost p-1.5 text-blue-500"><Coffee size={13} /></button>
                      <button onClick={() => openEdit(s)} className="btn-ghost p-1.5"><Pencil size={14} /></button>
                      <button onClick={() => remove(s)} className="btn-ghost p-1.5 text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {shifts.length === 0 && <p className="text-center text-slate-400 py-8">No shifts found.</p>}
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
    </div>
  );
}
