'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserPlus, Trash2, Mail, Loader2, ShieldCheck, Clock } from 'lucide-react';
import ErrorBanner from '@/components/ErrorBanner';
import WageTable from '@/components/WageTable';
import { fetchJson } from '@/lib/apiClient';

interface Manager {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  invited: boolean;
}

export default function ManagersPage() {
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState('');
  const [removing, setRemoving] = useState('');

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
    setInviteMsg(`Invite sent to ${inviteEmail.trim()}.`);
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
        <h1 className="text-2xl font-bold text-slate-900">Managers</h1>
        <p className="text-sm text-slate-500">Who can sign in and manage ShiftFlow</p>
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
          They&apos;ll get an email with a link to set their own password. Nobody&apos;s password passes through here.
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

      <div className="pt-2">
        <WageTable />
      </div>
    </div>
  );
}
