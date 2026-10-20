'use client';

import { useMemo, useState } from 'react';
import { BellRing, Search, Send, Loader2, CheckCircle2 } from 'lucide-react';
import Modal from '@/components/Modal';
import SmsModeBanner from '@/components/SmsModeBanner';
import { Staff, SmsConfig } from '@/lib/types';

const PREVIEW_TEXT =
  'There have been changes made to the rosters. Please check your humanforce app to see your new rostered shifts.';

interface Result { sent: number; failed: number; skipped: number }

/**
 * Dashboard button + modal: pick specific staff and text them the fixed
 * "rosters changed" notice. Staff list is loaded on open; the server
 * re-checks who can actually be texted before sending (see
 * /api/roster-notify).
 */
export default function RosterNotifyButton() {
  const [open, setOpen] = useState(false);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [smsConfig, setSmsConfig] = useState<SmsConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [quietHours, setQuietHours] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function openModal() {
    setOpen(true);
    setError('');
    setQuietHours(false);
    setResult(null);
    setSelected([]);
    setQuery('');
    setLoading(true);
    try {
      const [s, c] = await Promise.all([
        fetch('/api/staff').then(r => r.json()),
        fetch('/api/sms/config').then(r => r.json()).catch(() => null),
      ]);
      setStaff(Array.isArray(s) ? s : []);
      setSmsConfig(c);
    } catch {
      setError('Could not load staff');
    } finally {
      setLoading(false);
    }
  }

  const activeStaff = useMemo(
    () => staff.filter(s => s.active && !s.archived).sort((a, b) => a.name.localeCompare(b.name)),
    [staff]
  );
  const canText = (s: Staff) => !!s.phone_e164 && !s.sms_opt_out;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? activeStaff.filter(s => s.name.toLowerCase().includes(q)) : activeStaff;
  }, [activeStaff, query]);

  const selectedReachable = activeStaff.filter(s => selected.includes(s.id) && canText(s)).length;

  function toggle(id: string) {
    setSelected(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
  }
  // "Select all" acts on what's currently shown (respects the search box)
  // and skips anyone who can't be texted.
  function selectVisible() {
    const ids = visible.filter(canText).map(s => s.id);
    setSelected(prev => Array.from(new Set([...prev, ...ids])));
  }

  async function send(force = false) {
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/roster-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staff_ids: selected, force }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not send notifications');
        setQuietHours(!!data.quiet_hours);
        return;
      }
      setResult(data);
    } catch {
      setError('Could not send notifications');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button type="button" onClick={openModal} className="btn-primary">
        <BellRing size={14} /> Notify roster changes
      </button>

      {open && (
        <Modal title="Notify roster changes" onClose={() => setOpen(false)} size="lg">
          {result ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2 text-sm text-slate-700">
                <CheckCircle2 size={18} className="text-green-600 flex-shrink-0 mt-0.5" />
                <p>
                  Notified <strong>{result.sent}</strong> staff member{result.sent === 1 ? '' : 's'}.
                  {result.failed > 0 && ` ${result.failed} failed to send.`}
                  {result.skipped > 0 && ` ${result.skipped} skipped (no phone number, or opted out).`}
                </p>
              </div>
              <div className="flex justify-end">
                <button onClick={() => setOpen(false)} className="btn-primary">Done</button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <SmsModeBanner config={smsConfig} />

              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                {PREVIEW_TEXT}
              </div>

              <div>
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search staff…"
                    className="input pl-8"
                    autoFocus
                  />
                </div>
                <div className="flex items-center justify-between mt-2 text-xs">
                  <span className="text-slate-500">{selectedReachable} selected</span>
                  <div className="flex gap-3">
                    <button type="button" onClick={selectVisible} className="text-blue-600 hover:underline">
                      Select {query.trim() ? 'shown' : 'all'}
                    </button>
                    <button type="button" onClick={() => setSelected([])} className="text-slate-500 hover:underline">
                      Clear
                    </button>
                  </div>
                </div>
                <div className="mt-2 rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-64 overflow-y-auto">
                  {loading ? (
                    <p className="text-sm text-slate-400 px-3 py-2">Loading staff…</p>
                  ) : visible.length === 0 ? (
                    <p className="text-sm text-slate-400 px-3 py-2">No staff match.</p>
                  ) : visible.map(s => (
                    <label
                      key={s.id}
                      className={`flex items-center gap-2 px-3 py-2 text-sm ${
                        canText(s) ? 'cursor-pointer hover:bg-slate-50' : 'opacity-50 cursor-not-allowed'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="rounded"
                        disabled={!canText(s)}
                        checked={selected.includes(s.id)}
                        onChange={() => toggle(s.id)}
                      />
                      <span className="text-slate-700">{s.name}</span>
                      {!s.phone_e164 && <span className="text-xs text-slate-400 ml-auto">no phone</span>}
                      {s.phone_e164 && s.sms_opt_out && <span className="text-xs text-amber-600 ml-auto">opted out</span>}
                    </label>
                  ))}
                </div>
              </div>

              {error && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
                {quietHours && (
                  <button onClick={() => send(true)} disabled={sending} className="btn-secondary">
                    Send anyway
                  </button>
                )}
                <button
                  onClick={() => send(false)}
                  disabled={sending || selectedReachable === 0}
                  className="btn-primary"
                >
                  {sending
                    ? <><Loader2 size={14} className="animate-spin" /> Sending…</>
                    : <><Send size={14} /> Notify {selectedReachable}</>}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
