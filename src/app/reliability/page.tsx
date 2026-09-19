'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Plus } from 'lucide-react';
import Modal from '@/components/Modal';
import ReliabilityBar from '@/components/ReliabilityBar';
import ErrorBanner from '@/components/ErrorBanner';
import { fetchJson } from '@/lib/apiClient';
import { Staff, ReliabilityIncident, IncidentType } from '@/lib/types';
import { INCIDENT_META } from '@/lib/incidentMeta';
import { formatDate, formatTimeOfDay, todayStr } from '@/lib/shiftUtils';

export default function ReliabilityPage() {
  const [incidents, setIncidents] = useState<ReliabilityIncident[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ staff_id: '', incident_type: 'no_show' as IncidentType, date: todayStr(), late_time: '', notes: '' });
  const [filterStaff, setFilterStaff] = useState('');

  async function load() {
    try {
      const [incidentData, staffData] = await Promise.all([
        fetchJson<ReliabilityIncident[]>('/api/reliability'),
        fetchJson<Staff[]>('/api/staff'),
      ]);
      setIncidents(incidentData);
      setStaff(staffData);
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load reliability data');
    }
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!form.staff_id) return;
    if (form.incident_type === 'late' && !form.late_time) return;
    await fetch('/api/reliability', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setModal(false);
    load();
  }

  // Stats per staff
  const staffStats = staff.map(s => {
    const sIncidents = incidents.filter(i => i.staff_id === s.id);
    return {
      staff: s,
      no_shows: sIncidents.filter(i => i.incident_type === 'no_show').length,
      no_answers: sIncidents.filter(i => i.incident_type === 'no_answer').length,
      rejections: sIncidents.filter(i => i.incident_type === 'rejected').length,
      lates: sIncidents.filter(i => i.incident_type === 'late').length,
      covered: sIncidents.filter(i => i.incident_type === 'covered').length,
      total: sIncidents.length,
    };
  }).filter(s => s.total > 0 || s.staff.reliability_score !== 50)
    .sort((a, b) => a.staff.reliability_score - b.staff.reliability_score);

  const flagged = staffStats.filter(s => s.staff.reliability_score < 40 || s.no_shows >= 2);

  const filtered = incidents.filter(i =>
    !filterStaff || i.staff?.name?.toLowerCase().includes(filterStaff.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reliability</h1>
          <p className="text-sm text-slate-500">Track staff attendance and contact behaviour</p>
        </div>
        <button onClick={() => setModal(true)} className="btn-primary"><Plus size={16} /> Log Incident</button>
      </div>

      {loadError && <ErrorBanner message={loadError} onRetry={load} />}

      {/* Flagged staff */}
      {flagged.length > 0 && (
        <div className="card p-4 border-red-200 bg-red-50/40">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-red-500" />
            <h2 className="font-semibold text-red-800">Flagged Staff ({flagged.length})</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {flagged.map(({ staff: s, no_shows, no_answers, rejections, lates }) => (
              <div key={s.id} className="bg-white rounded-lg border border-red-200 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-slate-800">{s.name}</span>
                  <span className="text-xs font-bold text-red-600">{s.reliability_score}/100</span>
                </div>
                <ReliabilityBar score={s.reliability_score} showLabel={false} />
                <div className="flex gap-3 mt-2 text-xs text-slate-500">
                  {no_shows > 0 && <span className="text-red-600">{no_shows}× no-show</span>}
                  {no_answers > 0 && <span>{no_answers}× no-answer</span>}
                  {rejections > 0 && <span>{rejections}× rejected</span>}
                  {lates > 0 && <span>{lates}× late</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All staff scores */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <h2 className="font-semibold text-slate-800">All Staff Scores</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {['Name', 'Reliability', 'No Shows', 'No Answer', 'Rejections', 'Late', 'Covered'].map(h => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {staff.sort((a, b) => a.reliability_score - b.reliability_score).map(s => {
              const stat = staffStats.find(st => st.staff.id === s.id);
              return (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{s.name}</td>
                  <td className="px-4 py-3 min-w-[160px]"><ReliabilityBar score={s.reliability_score} /></td>
                  <td className="px-4 py-3"><span className={stat?.no_shows ? 'badge-red' : 'text-slate-300'}>{stat?.no_shows ?? 0}</span></td>
                  <td className="px-4 py-3"><span className={stat?.no_answers ? 'badge-amber' : 'text-slate-300'}>{stat?.no_answers ?? 0}</span></td>
                  <td className="px-4 py-3"><span className={stat?.rejections ? 'badge-amber' : 'text-slate-300'}>{stat?.rejections ?? 0}</span></td>
                  <td className="px-4 py-3"><span className={stat?.lates ? 'badge-amber' : 'text-slate-300'}>{stat?.lates ?? 0}</span></td>
                  <td className="px-4 py-3"><span className={stat?.covered ? 'badge-green' : 'text-slate-300'}>{stat?.covered ?? 0}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Incident log */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">Incident Log</h2>
          <input className="input w-48" placeholder="Filter by name..." value={filterStaff} onChange={e => setFilterStaff(e.target.value)} />
        </div>
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-4">No incidents recorded yet.</p>
          ) : filtered.map(inc => {
            const meta = INCIDENT_META[inc.incident_type];
            return (
              <div key={inc.id} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                <span className={`${meta.badge} flex items-center gap-1`}>{meta.icon}{meta.label}</span>
                <span className="font-medium text-slate-700">{inc.staff?.name ?? '—'}</span>
                <span className="text-slate-400 text-sm">
                  {formatDate(inc.date)}
                  {inc.incident_type === 'late' && inc.late_time && ` · arrived ${formatTimeOfDay(inc.late_time.slice(0, 5))}`}
                </span>
                <span className={`text-xs ml-auto font-mono font-bold ${inc.incident_type === 'covered' ? 'text-green-600' : 'text-red-500'}`}>{meta.delta}</span>
                {inc.notes && <span className="text-xs text-slate-400">{inc.notes}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {modal && (
        <Modal title="Log Incident" onClose={() => setModal(false)}>
          <div className="space-y-4">
            <div>
              <label className="label">Staff Member</label>
              <select className="input" value={form.staff_id} onChange={e => setForm(f => ({ ...f, staff_id: e.target.value }))}>
                <option value="">Select staff...</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Incident Type</label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.entries(INCIDENT_META) as [IncidentType, typeof INCIDENT_META[IncidentType]][]).map(([type, meta]) => (
                  <label key={type} className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${form.incident_type === type ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`}>
                    <input type="radio" name="incident_type" value={type} checked={form.incident_type === type} onChange={() => setForm(f => ({ ...f, incident_type: type }))} className="accent-blue-600" />
                    <span className={meta.badge + ' flex items-center gap-1'}>{meta.icon}{meta.label}</span>
                    <span className="text-xs text-slate-400 ml-auto">{meta.delta}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className={form.incident_type === 'late' ? 'grid grid-cols-2 gap-3' : undefined}>
              <div>
                <label className="label">Date</label>
                <input type="date" className="input" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              {form.incident_type === 'late' && (
                <div>
                  <label className="label">Arrived at</label>
                  <input type="time" className="input" value={form.late_time} onChange={e => setForm(f => ({ ...f, late_time: e.target.value }))} />
                </div>
              )}
            </div>
            <div>
              <label className="label">Notes (optional)</label>
              <input className="input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any context..." />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={save} disabled={!form.staff_id || (form.incident_type === 'late' && !form.late_time)} className="btn-primary">Log Incident</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
