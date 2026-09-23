'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Trophy, Clock, XCircle, CheckCircle2, AlertTriangle, MessageSquare,
  Send, Ban, PhoneOff, Loader2,
} from 'lucide-react';
import { RaceDetail, ClaimRecipient, SmsConfig } from '@/lib/types';
import { formatAUMobile } from '@/lib/phone';
import StaffName from './StaffName';

const POLL_MS = 4000;

export default function RaceStatusPanel({
  raceId, config, onFinished,
}: {
  raceId: string;
  config: SmsConfig | null;
  onFinished?: () => void;
}) {
  const [detail, setDetail] = useState<RaceDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/claim-race/${raceId}`);
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Failed to load race'); return; }
    setDetail(data);
    return data as RaceDetail;
  }, [raceId]);

  useEffect(() => { load(); }, [load]);

  // Poll only while the race can still change — including while it's
  // waiting on the manager's pick, since that resolves by SMS reply, not by
  // anything happening in this browser tab.
  const inProgress = (status?: string) => status === 'active' || status === 'awaiting_pick';
  useEffect(() => {
    if (!inProgress(detail?.race.status)) return;
    const t = setInterval(async () => {
      const next = await load();
      if (next && !inProgress(next.race.status)) onFinished?.();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [detail?.race.status, load, onFinished]);

  async function simulate(recipient: ClaimRecipient, reply: string) {
    setBusy(recipient.id + reply);
    const simulateToken = process.env.NEXT_PUBLIC_SMS_SIMULATE_TOKEN;
    const res = await fetch('/api/sms/simulate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(simulateToken ? { 'x-simulate-token': simulateToken } : {}),
      },
      body: JSON.stringify({ recipient_id: recipient.id, body: reply }),
    });
    if (!res.ok) setError((await res.json()).error ?? 'Simulation failed');
    setBusy('');
    const next = await load();
    if (next && next.race.status !== 'active') onFinished?.();
  }

  async function cancel() {
    if (!confirm('Cancel this claim race? Staff who were texted will not be told.')) return;
    setBusy('cancel');
    await fetch(`/api/claim-race/${raceId}`, { method: 'DELETE' });
    setBusy('');
    await load();
    onFinished?.();
  }

  if (error) {
    return (
      <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-800">{error}</div>
    );
  }
  if (!detail) {
    return (
      <div className="card p-6 flex items-center gap-2 text-slate-400 text-sm">
        <Loader2 size={15} className="animate-spin" /> Loading race…
      </div>
    );
  }

  const { race, recipients, messages } = detail;
  const winner = recipients.find(r => r.outcome === 'won');
  const contacted = recipients.filter(r => r.send_status === 'sent');
  const skipped = recipients.filter(
    r => r.send_status === 'skipped_no_phone' || r.send_status === 'skipped_opted_out'
  );
  const failed = recipients.filter(r => r.send_status === 'failed');
  const canSimulate = config?.simulation_enabled && race.status === 'active';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className={`card p-4 ${race.status === 'claimed' ? 'border-green-300 bg-green-50/60' : ''}`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-900">Claim Race</h3>
              <StatusBadge status={race.status} />
              <span className="badge-slate uppercase text-[10px]">{race.mode}</span>
            </div>
            <p className="text-sm text-slate-600 mt-1">
              {contacted.length} contacted
              {skipped.length > 0 && ` · ${skipped.length} skipped`}
              {failed.length > 0 && ` · ${failed.length} failed`}
              {race.status === 'active' && ` · expires ${new Date(race.expires_at).toLocaleTimeString()}`}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">{tierNote(race)}</p>
            {winner && (
              <p className="text-sm text-green-800 mt-2 flex items-center gap-1.5 font-medium">
                <Trophy size={14} className="text-amber-500" />
                {winner.staff?.name && (
                  <StaffName staffId={winner.staff_id} name={winner.staff.name} className="text-green-800" />
                )}{' '}claimed the shift
                {winner.responded_at && ` at ${new Date(winner.responded_at).toLocaleTimeString()}`}
              </p>
            )}
          </div>
          {race.status === 'active' && (
            <button onClick={cancel} disabled={!!busy} className="btn-secondary text-sm">
              <Ban size={14} /> Cancel race
            </button>
          )}
        </div>
      </div>

      {race.status === 'active' && config?.mode === 'live' && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 flex items-center gap-1.5">
          <PhoneOff size={12} className="flex-shrink-0" />
          Live mode — there's nothing to click here. A reply can only come from a real phone texting back.
        </div>
      )}

      {/* Recipients */}
      <div className="card divide-y divide-slate-100">
        <div className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Recipients
        </div>
        {recipients.map(r => (
          <div key={r.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
            <OutcomeIcon recipient={r} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {r.staff?.name ? (
                  <StaffName staffId={r.staff_id} name={r.staff.name} className="font-medium text-slate-800" />
                ) : (
                  <span className="font-medium text-slate-800">Unknown</span>
                )}
                {r.send_status === 'sent' && (
                  <code className="text-[11px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                    {r.claim_code}
                  </code>
                )}
                <SendStatusBadge recipient={r} />
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {r.phone_e164 ? formatAUMobile(r.phone_e164) : 'No valid mobile'}
                {r.response_body && ` · replied "${r.response_body}"`}
                {r.send_error && ` · ${r.send_error}`}
              </p>
            </div>

            {canSimulate && r.send_status === 'sent' && !r.outcome && (
              <div className="flex gap-1.5">
                <button
                  onClick={() => simulate(r, `YES ${r.claim_code}`)}
                  disabled={!!busy}
                  className="btn-ghost text-xs px-2 py-1 text-green-700 hover:bg-green-50"
                  title={`Simulate "YES ${r.claim_code}" from ${r.staff?.name}`}
                >
                  {busy === r.id + `YES ${r.claim_code}`
                    ? <Loader2 size={12} className="animate-spin" />
                    : <Send size={12} />} Reply YES
                </button>
                <button
                  onClick={() => simulate(r, `NO ${r.claim_code}`)}
                  disabled={!!busy}
                  className="btn-ghost text-xs px-2 py-1 text-slate-500"
                >
                  Reply NO
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Message log — the whole point of console mode */}
      {messages.length > 0 && (
        <div className="card">
          <div className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5 border-b border-slate-100">
            <MessageSquare size={13} /> Message log ({messages.length})
          </div>
          <div className="divide-y divide-slate-50 max-h-80 overflow-y-auto">
            {messages.map(m => (
              <div key={m.id} className="px-4 py-2.5 text-sm">
                <div className="flex items-center gap-2 text-xs text-slate-400 mb-1 flex-wrap">
                  <span className={m.direction === 'out' ? 'text-blue-600' : 'text-green-600'}>
                    {m.direction === 'out' ? '→ OUT' : '← IN'}
                  </span>
                  <span>{m.intended_for || m.to_phone}</span>
                  <span>·</span>
                  <span>{new Date(m.created_at).toLocaleTimeString()}</span>
                  {m.status && <span className="badge-slate text-[10px]">{m.status}</span>}
                  {m.error && <span className="badge-red text-[10px]">{m.error}</span>}
                </div>
                <p className="text-slate-700 font-mono text-xs leading-relaxed">{m.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** One line explaining what the tier is currently doing — the immediate and
 *  sequential tiers only text a few people at a time, so without this a
 *  manager could easily read "2 contacted" out of 8 eligible as a bug. */
function tierNote(race: RaceDetail['race']): string {
  if (race.status === 'awaiting_pick') {
    return 'Waiting on your pick — reply with a number from the list you were sent.';
  }
  if (race.status !== 'active') return '';

  if (race.tier === 'immediate') {
    const batch = (race.current_batch ?? 0) + 1;
    return `Immediate — asking in pairs, batch ${batch}. Escalates automatically if there's no answer.`;
  }
  if (race.tier === 'sequential') {
    const position = (race.sequential_index ?? 0) + 1;
    return `Sequential — asking one at a time (cheapest first), currently #${position}.`;
  }
  if (race.degraded_at) {
    return 'Gather — nobody was available, now first reply wins.';
  }
  if (race.gather_deadline) {
    return `Gather — collecting replies until ${new Date(race.gather_deadline).toLocaleTimeString()}, then you'll be sent a list to pick from.`;
  }
  return '';
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'badge-blue', claimed: 'badge-green',
    expired: 'badge-amber', cancelled: 'badge-slate', awaiting_pick: 'badge-blue',
  };
  const label = status === 'awaiting_pick' ? 'Awaiting manager pick' : status;
  return <span className={`${map[status] ?? 'badge-slate'} capitalize`}>{label}</span>;
}

function SendStatusBadge({ recipient }: { recipient: ClaimRecipient }) {
  if (recipient.outcome === 'won') return <span className="badge-green">Claimed it</span>;
  if (recipient.outcome === 'declined') return <span className="badge-amber">Declined</span>;
  if (recipient.outcome === 'lost') return <span className="badge-slate">Too late</span>;
  if (recipient.send_status === 'skipped_no_phone') return <span className="badge-red">No mobile</span>;
  if (recipient.send_status === 'skipped_opted_out') return <span className="badge-red">Opted out</span>;
  if (recipient.send_status === 'failed') return <span className="badge-red">Send failed</span>;
  if (recipient.outcome === 'no_response') return <span className="badge-slate">No reply</span>;
  return <span className="badge-blue">Waiting</span>;
}

function OutcomeIcon({ recipient }: { recipient: ClaimRecipient }) {
  const base = 'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center';
  if (recipient.outcome === 'won')
    return <div className={`${base} bg-green-100`}><Trophy size={14} className="text-amber-500" /></div>;
  if (recipient.outcome === 'declined')
    return <div className={`${base} bg-amber-100`}><XCircle size={14} className="text-amber-600" /></div>;
  if (recipient.outcome === 'lost')
    return <div className={`${base} bg-slate-100`}><CheckCircle2 size={14} className="text-slate-400" /></div>;
  if (recipient.send_status === 'failed')
    return <div className={`${base} bg-red-100`}><AlertTriangle size={14} className="text-red-500" /></div>;
  if (recipient.send_status.startsWith('skipped'))
    return <div className={`${base} bg-red-50`}><PhoneOff size={14} className="text-red-400" /></div>;
  return <div className={`${base} bg-blue-50`}><Clock size={14} className="text-blue-400" /></div>;
}
