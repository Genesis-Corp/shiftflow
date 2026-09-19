'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { UserPlus, Trash2, Mail, Loader2, ShieldCheck, Clock, History } from 'lucide-react';
import ErrorBanner from '@/components/ErrorBanner';
import WageTable from '@/components/WageTable';
import { fetchJson } from '@/lib/apiClient';
import { ReliabilityIncident } from '@/lib/types';
import { INCIDENT_META } from '@/lib/incidentMeta';
import { formatDate, formatTimeOfDay } from '@/lib/shiftUtils';

interface Manager {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  invited: boolean;
}

export default function SettingsPage() {
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState('');
  const [removing, setRemoving] = useState('');

  // Read-only copy of the Reliability page's incident log — no shows, sick
  // calls (logged as a no-show), lates and rejections all land here so a
  // manager can skim it without leaving Settings. Logging a new one, or
  // seeing scores, still happens on the Reliability page itself.
  const [incidents, setIncidents] = useState<ReliabilityIncident[]>([]);
  const [incidentsError, setIncidentsError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setManagers(await fetchJson<Manager[]>('/api/managers'));
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load managers');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchJson<ReliabilityIncident[]>('/api/reliability')
      .then(setIncidents)
      .catch(err => setIncidentsError(err instanceof Error ? err.message : 'Failed to load incident log'));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteMsg('');
    const res = await fetch('/api/managers/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail.trim() }),
    });
    const data = await res.json();
    setInviting(false);
    if (!res.ok) { setInviteMsg(data.error ?? 'Failed to send invite'); return; }
    setInviteMsg(`Invite sent to ${inviteEmail.trim()}. They'll be asked for their name and mobile number the first time they sign in.`);
    setInviteEmail('');
    load();
  }

  async function remove(m: Manager) {
    if (!confirm(`Remove ${m.email}'s access? They'll be signed out immediately.`)) return;
    setRemoving(m.id);
    const res = await fetch(`/api/managers/${m.id}`, { method: 'DELETE' });
    setRemoving('');
    if (!res.ok) { const d = await res.json(); alert(d.error ?? 'Failed to remove'); return; }
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">Managers, wages and store configuration</p>
      </div>

      {loadError && <ErrorBanner message={loadError} onRetry={load} />}

      <div className="card p-5">
        <h2 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <UserPlus size={16} className="text-slate-400" /> Invite a manager
        </h2>
        <form onSubmit={invite} className="flex gap-2 flex-wrap">
          <input
            type="email" required placeholder="name@example.com"
            className="input flex-1 min-w-[16rem]"
            value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
          />
          <button type="submit" disabled={inviting} className="btn-primary">
            {inviting ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
            Send invite
          </button>
        </form>
        {inviteMsg && <p className="text-sm text-slate-500 mt-2">{inviteMsg}</p>}
        <p className="text-xs text-slate-400 mt-2">
          They&apos;ll get an email with a link to set their own password, then fill in their name and mobile
          number themselves the first time they sign in. Nobody&apos;s password passes through here.
        </p>
      </div>

      {loading ? (
        <p className="text-slate-400">Loading…</p>
      ) : (
        <div className="card divide-y divide-slate-100">
          {managers.map(m => (
            <div key={m.id} className="px-4 py-3 flex items-center gap-3">
              <ShieldCheck size={16} className="text-blue-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-800 truncate">{m.email}</p>
                <p className="text-xs text-slate-400 flex items-center gap-1">
                  {m.invited
                    ? <><Clock size={11} /> Invited, hasn&apos;t signed in yet</>
                    : `Last signed in ${new Date(m.last_sign_in_at!).toLocaleString()}`}
                </p>
              </div>
              <button
                onClick={() => remove(m)}
                disabled={removing === m.id}
                title="Remove access"
                className="btn-ghost p-1.5 text-red-500 hover:bg-red-50"
              >
                {removing === m.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              </button>
            </div>
          ))}
        </div>
      )}

      <details className="card overflow-hidden">
        <summary className="cursor-pointer select-none px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
            <History size={16} className="text-slate-400" /> Incident Log
            {incidents.length > 0 && <span className="text-xs font-normal text-slate-400">({incidents.length})</span>}
          </h2>
          <span className="text-xs text-slate-400">No shows, sick calls, lates and more</span>
        </summary>
        <div className="border-t border-slate-100">
          {incidentsError && <p className="px-5 py-3 text-sm text-red-600">{incidentsError}</p>}
          {!incidentsError && incidents.length === 0 && (
            <p className="px-5 py-4 text-sm text-slate-400 text-center">No incidents recorded yet.</p>
          )}
          {incidents.length > 0 && (
            <div className="divide-y divide-slate-100 max-h-[28rem] overflow-y-auto">
              {incidents.map(inc => {
                const meta = INCIDENT_META[inc.incident_type];
                return (
                  <div key={inc.id} className="px-5 py-2.5 flex items-center gap-3 flex-wrap">
                    <span className={`${meta.badge} flex items-center gap-1`}>{meta.icon}{meta.label}</span>
                    <span className="font-medium text-slate-700">{inc.staff?.name ?? '—'}</span>
                    <span className="text-slate-400 text-sm">
                      {formatDate(inc.date)}
                      {inc.incident_type === 'late' && inc.late_time && ` · arrived ${formatTimeOfDay(inc.late_time.slice(0, 5))}`}
                    </span>
                    <span className={`text-xs ml-auto font-mono font-bold ${inc.incident_type === 'covered' ? 'text-green-600' : 'text-red-500'}`}>{meta.delta}</span>
                    {inc.notes && <span className="text-xs text-slate-400 w-full sm:w-auto">{inc.notes}</span>}
                  </div>
                );
              })}
            </div>
          )}
          <div className="px-5 py-3 border-t border-slate-100">
            <Link href="/reliability" className="text-xs text-blue-600 hover:text-blue-700 font-medium">
              Log an incident or view staff scores →
            </Link>
          </div>
        </div>
      </details>

      <div className="pt-2">
        <WageTable />
      </div>
    </div>
  );
}
