'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MessageSquare, Bold, Italic, Underline, Send, Loader2, Info, Search,
} from 'lucide-react';
import Modal from '@/components/Modal';
import SmsModeBanner from '@/components/SmsModeBanner';
import StaffName from '@/components/StaffName';
import { Staff, Department, SmsConfig } from '@/lib/types';
import { toBoldUnicode, toItalicUnicode, toUnderlineUnicode } from '@/lib/textFormatting';
import { isGsm7, smsSegments } from '@/lib/sms/segments';

type Urgency = 'general' | 'urgent';
type TargetType = 'all' | 'departments' | 'custom';

interface Post {
  id: string;
  created_at: string;
  manager_name: string | null;
  urgency: Urgency;
  body: string;
  target_type: TargetType;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
}

const MAX_BODY_LENGTH = 600;

function formatPostTime(iso: string): string {
  return new Date(iso).toLocaleString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Manager-authored broadcast to staff phones — "urgent"/"general" updates
 * sent to everyone, a set of departments, or a hand-picked list. Recipients
 * are only *previewed* here from data already on the page; the server
 * re-resolves them for real before anything is sent (see
 * /api/message-board), the same "browser decides nothing" rule the claim
 * race candidate list follows.
 */
export default function MessageBoard() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [smsConfig, setSmsConfig] = useState<SmsConfig | null>(null);

  const [urgency, setUrgency] = useState<Urgency>('general');
  const [targetType, setTargetType] = useState<TargetType>('all');
  const [selectedDeptIds, setSelectedDeptIds] = useState<string[]>([]);
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [staffFilter, setStaffFilter] = useState('');
  const [body, setBody] = useState('');

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [quietHours, setQuietHours] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch('/api/staff').then(r => r.json()).then(setStaff).catch(() => {});
    fetch('/api/departments').then(r => r.json()).then(setDepartments).catch(() => {});
    fetch('/api/sms/config').then(r => r.json()).then(setSmsConfig).catch(() => {});
    loadFeed();
  }, []);

  function loadFeed() {
    fetch('/api/message-board').then(r => r.json()).then(d => setPosts(Array.isArray(d) ? d : [])).catch(() => {});
  }

  // Same eligibility shape the server uses (active, not archived, has a
  // phone, not opted out) — an estimate for the UI, not what actually
  // decides who gets texted.
  const contactablePool = useMemo(() => {
    let pool = staff.filter(s => s.active && !s.archived);
    if (targetType === 'departments') {
      const wanted = new Set(selectedDeptIds);
      pool = pool.filter(s => (s.staff_departments ?? []).some(d => wanted.has(d.department_id)));
    } else if (targetType === 'custom') {
      const wanted = new Set(selectedStaffIds);
      pool = pool.filter(s => wanted.has(s.id));
    }
    return pool;
  }, [staff, targetType, selectedDeptIds, selectedStaffIds]);

  const contactable = contactablePool.filter(s => s.phone_e164 && !s.sms_opt_out);
  const skipped = contactablePool.length - contactable.length;

  const filteredStaffOptions = useMemo(() => {
    const active = staff.filter(s => s.active && !s.archived);
    if (!staffFilter.trim()) return active;
    const q = staffFilter.trim().toLowerCase();
    return active.filter(s => s.name.toLowerCase().includes(q));
  }, [staff, staffFilter]);

  const trimmedBody = body.trim();
  const segments = smsSegments(trimmedBody);
  const usesFormatting = trimmedBody.length > 0 && !isGsm7(trimmedBody);

  function toggleDept(id: string) {
    setSelectedDeptIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
  }
  function toggleStaff(id: string) {
    setSelectedStaffIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
  }

  /** Transforms the selected text in the textarea, leaving the rest as-is —
   *  a no-op if nothing is selected, rather than guessing what to format. */
  function applyFormat(transform: (s: string) => string) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    if (start === end) return;
    const formatted = transform(body.slice(start, end));
    const next = body.slice(0, start) + formatted + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start, start + formatted.length);
    });
  }

  function openConfirm() {
    setError('');
    setQuietHours(false);
    setConfirmOpen(true);
  }

  async function doSend(force = false) {
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/message-board', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urgency,
          body: trimmedBody,
          target_type: targetType,
          department_ids: targetType === 'departments' ? selectedDeptIds : undefined,
          staff_ids: targetType === 'custom' ? selectedStaffIds : undefined,
          force,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not send that update');
        setQuietHours(!!data.quiet_hours);
        return;
      }
      setConfirmOpen(false);
      setBody('');
      setSelectedDeptIds([]);
      setSelectedStaffIds([]);
      setStaffFilter('');
      loadFeed();
    } finally {
      setSending(false);
    }
  }

  const targetLabel =
    targetType === 'all' ? 'All staff'
    : targetType === 'departments' ? `${selectedDeptIds.length} department${selectedDeptIds.length === 1 ? '' : 's'}`
    : `${selectedStaffIds.length} staff member${selectedStaffIds.length === 1 ? '' : 's'}`;

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare size={16} className="text-blue-500" />
        <h2 className="font-semibold text-slate-800">Message Board</h2>
      </div>

      <div className="space-y-3">
        <SmsModeBanner config={smsConfig} />

        {/* Urgency */}
        <div>
          <p className="label mb-1.5">Urgency</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setUrgency('general')}
              className={`btn ${urgency === 'general' ? 'bg-blue-600 text-white' : 'btn-secondary'}`}>
              General
            </button>
            <button type="button" onClick={() => setUrgency('urgent')}
              className={`btn ${urgency === 'urgent' ? 'bg-red-600 text-white' : 'btn-secondary'}`}>
              Urgent
            </button>
          </div>
          {urgency === 'urgent' && (
            <p className="text-xs text-slate-400 mt-1">Sends immediately, even during quiet hours.</p>
          )}
        </div>

        {/* Target */}
        <div>
          <p className="label mb-1.5">Send to</p>
          <div className="flex gap-2 flex-wrap">
            {(['all', 'departments', 'custom'] as TargetType[]).map(t => (
              <button key={t} type="button" onClick={() => setTargetType(t)}
                className={`btn ${targetType === t ? 'bg-blue-600 text-white' : 'btn-secondary'}`}>
                {t === 'all' ? 'All' : t === 'departments' ? 'Departments' : 'Custom'}
              </button>
            ))}
          </div>

          {targetType === 'departments' && (
            <div className="mt-2 flex flex-wrap gap-2">
              {departments.map(d => (
                <label key={d.id}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-sm cursor-pointer ${
                    selectedDeptIds.includes(d.id) ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-600'
                  }`}>
                  <input type="checkbox" className="rounded" checked={selectedDeptIds.includes(d.id)}
                    onChange={() => toggleDept(d.id)} />
                  {d.name}
                </label>
              ))}
              {departments.length === 0 && <p className="text-sm text-slate-400">No departments yet.</p>}
            </div>
          )}

          {targetType === 'custom' && (
            <div className="mt-2">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={staffFilter} onChange={e => setStaffFilter(e.target.value)}
                  placeholder="Search staff…" className="input pl-8" />
              </div>
              <div className="mt-2 rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-48 overflow-y-auto">
                {filteredStaffOptions.map(s => (
                  <label key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                    <input type="checkbox" className="rounded" checked={selectedStaffIds.includes(s.id)}
                      onChange={() => toggleStaff(s.id)} />
                    <span className="text-slate-700">{s.name}</span>
                    {!s.phone_e164 && <span className="text-xs text-slate-400 ml-auto">no phone</span>}
                    {s.sms_opt_out && <span className="text-xs text-amber-600 ml-auto">opted out</span>}
                  </label>
                ))}
                {filteredStaffOptions.length === 0 && (
                  <p className="text-sm text-slate-400 px-3 py-2">No staff match.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Message */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="label mb-0">Message</p>
            <div className="flex gap-1">
              <button type="button" title="Bold selected text" onClick={() => applyFormat(toBoldUnicode)}
                className="btn-ghost p-1.5 rounded-md"><Bold size={14} /></button>
              <button type="button" title="Italic selected text" onClick={() => applyFormat(toItalicUnicode)}
                className="btn-ghost p-1.5 rounded-md"><Italic size={14} /></button>
              <button type="button" title="Underline selected text" onClick={() => applyFormat(toUnderlineUnicode)}
                className="btn-ghost p-1.5 rounded-md"><Underline size={14} /></button>
            </div>
          </div>
          <textarea
            ref={textareaRef}
            value={body}
            onChange={e => setBody(e.target.value.slice(0, MAX_BODY_LENGTH))}
            rows={5}
            placeholder="Write an update for staff… select text and use Bold/Italic/Underline above to format it."
            className="input resize-none"
          />
          <div className="flex items-start justify-between gap-2 mt-1">
            <p className="text-xs text-slate-400">
              {body.length}/{MAX_BODY_LENGTH} characters · {segments} SMS segment{segments === 1 ? '' : 's'} per recipient
            </p>
            <p className="text-xs text-slate-500 text-right">{contactable.length} of {contactablePool.length} reachable</p>
          </div>
          {usesFormatting && (
            <p className="flex items-start gap-1.5 text-xs text-slate-400 mt-1">
              <Info size={13} className="flex-shrink-0 mt-0.5" />
              Bold/italic/underline render on most modern phones as special characters (not real SMS
              styling — it doesn&apos;t exist) and roughly double the segment cost above. Very old phones
              may show boxes instead.
            </p>
          )}
        </div>

        {error && !confirmOpen && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end">
          <button type="button" onClick={openConfirm}
            disabled={!trimmedBody || contactable.length === 0}
            className="btn-primary">
            <Send size={14} /> {targetType === 'all' ? `Send All (${contactable.length})` : `Send (${contactable.length})`}
          </button>
        </div>
      </div>

      {/* Recent updates feed */}
      <div className="mt-4 pt-3 border-t border-slate-100">
        <p className="text-xs font-medium text-slate-500 mb-2">Recent updates</p>
        {posts.length === 0 ? (
          <p className="text-sm text-slate-400">No updates sent yet.</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {posts.map(p => (
              <div key={p.id} className="py-2 border-b border-slate-50 last:border-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={p.urgency === 'urgent' ? 'badge-red' : 'badge-blue'}>{p.urgency}</span>
                  <span className="text-xs text-slate-400">{formatPostTime(p.created_at)}</span>
                  {p.manager_name && <span className="text-xs text-slate-400">· {p.manager_name}</span>}
                </div>
                <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap break-words">{p.body}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {p.sent_count} sent
                  {p.failed_count > 0 && `, ${p.failed_count} failed`}
                  {p.skipped_count > 0 && `, ${p.skipped_count} skipped`}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmOpen && (
        <Modal title={urgency === 'urgent' ? 'Send urgent update?' : 'Send update?'} onClose={() => setConfirmOpen(false)} size="lg">
          <div className="space-y-4">
            <SmsModeBanner config={smsConfig} />

            <p className="text-sm text-slate-600">
              <strong>{contactable.length}</strong> staff will be texted ({targetLabel}).
              {skipped > 0 && ` ${skipped} more match but cannot be reached (no phone number, or opted out).`}
            </p>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 whitespace-pre-wrap break-words">
              {trimmedBody}
            </div>

            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-48 overflow-y-auto">
              {contactable.slice(0, 50).map(s => (
                <div key={s.id} className="px-3 py-1.5 text-sm">
                  <StaffName staffId={s.id} name={s.name} className="text-slate-800" />
                </div>
              ))}
              {contactable.length > 50 && (
                <div className="px-3 py-1.5 text-xs text-slate-400">…and {contactable.length - 50} more</div>
              )}
            </div>

            {error && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setConfirmOpen(false)} className="btn-secondary">Cancel</button>
              {quietHours && (
                <button onClick={() => doSend(true)} disabled={sending} className="btn-secondary">
                  {sending ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : 'Send anyway'}
                </button>
              )}
              <button onClick={() => doSend(false)} disabled={sending} className="btn-primary">
                {sending
                  ? <><Loader2 size={14} className="animate-spin" /> Sending…</>
                  : <><Send size={14} /> Send to {contactable.length}</>}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
