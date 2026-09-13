'use client';

import { useEffect, useState } from 'react';
import { Search, Trophy, Phone, CheckCircle, XCircle, PhoneMissed } from 'lucide-react';
import ErrorBanner from '@/components/ErrorBanner';
import ReliabilityBar from '@/components/ReliabilityBar';
import { Department, CoverCandidate } from '@/lib/types';
import { fetchList } from '@/lib/api';
import { formatDuration, requiresBreak, BREAK_DURATION_MINUTES } from '@/lib/shiftUtils';

interface CoverResult {
  shift: { date: string; start_time: string; end_time: string; department: Department };
  eligible_count: number;
  candidates: CoverCandidate[];
}

export default function CoverShiftPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    start_time: '09:00', end_time: '17:00',
    department_id: '', required_role: 'any',
  });
  const [result, setResult] = useState<CoverResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [claimMsg, setClaimMsg] = useState('');
  const [incidentLoading, setIncidentLoading] = useState('');

  async function load() {
    const { data, error } = await fetchList<Department>('/api/departments');
    setDepartments(data);
    setLoadError(error);
    if (data[0]) setForm(f => ({ ...f, department_id: data[0].id }));
  }

  useEffect(() => { load(); }, []);

  async function findCover() {
    if (!form.department_id) return;
    setLoading(true); setResult(null); setClaimMsg('');
    const res = await fetch('/api/cover-shift', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setResult(await res.json());
    setLoading(false);
  }

  async function startClaimRace() {
    if (!result?.candidates.length) return;
    const top = result.candidates[0];
    setClaimMsg(`Claim race started — contacting ${top.name} first (score: ${top.computed_score}). Queue: ${result.candidates.slice(1).map(c => c.name).join(' → ')}`);
  }

  async function logIncident(staffId: string, type: 'no_show' | 'no_answer' | 'rejected' | 'covered') {
    setIncidentLoading(staffId + type);
    await fetch('/api/reliability', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staff_id: staffId, incident_type: type, date: form.date }),
    });
    setIncidentLoading('');
    // Refresh results
    findCover();
  }

  const needsBreak = requiresBreak(form.start_time, form.end_time);

  return (
    <div className="space-y-6">
      <ErrorBanner message={loadError} onRetry={load} />
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Find Cover</h1>
        <p className="text-sm text-slate-500">Enter the shift details to find available staff</p>
      </div>

      {/* Search form */}
      <div className="card p-5">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 items-end">
          <div>
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
          <div>
            <label className="label">Department</label>
            <select className="input" value={form.department_id} onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))}>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.required_role} onChange={e => setForm(f => ({ ...f, required_role: e.target.value }))}>
              <option value="any">Any</option>
              <option value="senior">Senior</option>
              <option value="junior">Junior</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-4 mt-4">
          <button onClick={findCover} disabled={loading || !form.department_id} className="btn-primary">
            <Search size={16} /> {loading ? 'Searching...' : 'Find Available Staff'}
          </button>
          <p className="text-sm text-slate-500">
            Duration: <strong>{formatDuration(form.start_time, form.end_time)}</strong>
            {needsBreak && <span className="ml-2 text-amber-600">+ {BREAK_DURATION_MINUTES}m break</span>}
          </p>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-slate-700">
              Found <strong>{result.eligible_count} eligible staff</strong> for {result.shift.department?.name} · {result.shift.start_time}–{result.shift.end_time}
            </p>
            {result.candidates.length > 0 && (
              <button onClick={startClaimRace} className="btn-primary">
                <Phone size={14} /> Start Claim Race
              </button>
            )}
          </div>

          {claimMsg && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
              {claimMsg}
            </div>
          )}

          {result.candidates.length === 0 ? (
            <div className="card p-8 text-center text-slate-400">
              <p className="font-medium">No eligible staff found</p>
              <p className="text-sm mt-1">Try a different time range or check staff availability templates.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {result.candidates.map((c, i) => (
                <div key={c.id} className={`card p-4 flex items-center gap-4 ${i === 0 ? 'border-blue-300 bg-blue-50/50' : ''}`}>
                  <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold bg-slate-100 text-slate-600">
                    {i === 0 ? <Trophy size={16} className="text-amber-500" /> : i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-800">{c.name}</span>
                      <span className={c.age_group === 'senior' ? 'badge-blue' : 'badge-amber'}>
                        {c.age_group === 'senior' ? 'Senior' : 'Junior'}
                      </span>
                      <span className="badge-slate capitalize">{c.role_type.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="mt-1.5 w-48">
                      <ReliabilityBar score={c.reliability_score} />
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-lg font-bold text-slate-700">{c.computed_score}</p>
                    <p className="text-xs text-slate-400">score</p>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      title="Covered"
                      disabled={!!incidentLoading}
                      onClick={() => logIncident(c.id, 'covered')}
                      className="btn-ghost p-1.5 text-green-600 hover:bg-green-50"
                    ><CheckCircle size={16} /></button>
                    <button
                      title="Rejected"
                      disabled={!!incidentLoading}
                      onClick={() => logIncident(c.id, 'rejected')}
                      className="btn-ghost p-1.5 text-orange-500 hover:bg-orange-50"
                    ><XCircle size={16} /></button>
                    <button
                      title="No answer"
                      disabled={!!incidentLoading}
                      onClick={() => logIncident(c.id, 'no_answer')}
                      className="btn-ghost p-1.5 text-slate-500 hover:bg-slate-100"
                    ><PhoneMissed size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
