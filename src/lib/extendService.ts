import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  shiftsOverlap, mergeShiftRanges, shiftDurationMinutes, requiresBreak, clashesWithOtherShift,
  BREAK_DURATION_MINUTES, MAX_EXTENDED_SHIFT_MINUTES,
} from '@/lib/shiftUtils';
import { sendSms } from '@/lib/sms/send';
import { extendAskMessage, extendConfirmedMessage, declinedMessage, tooLateMessage, ShiftSummary } from '@/lib/sms/templates';
import { getExpiryMinutes, getBusinessName } from '@/lib/sms/config';
import { parseInboundMessage } from '@/lib/claimRace';

/**
 * Extending someone's shift LATER is a manager decision made in person —
 * they're already on shift, there's no one to text. Extending it EARLIER
 * means asking someone who isn't at the store yet, so that direction goes
 * through an SMS confirmation (shift_extend_requests) instead of applying
 * instantly. Both directions end up at the same applyExtension() — the only
 * difference is what has to happen before it's safe to call.
 */

export class ExtendError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type ShiftRow = Record<string, any>;

export type ExtendOutcome =
  | { applied: true; shift: ShiftRow }
  | { applied: false; pending: true; requestId: string };

async function applyExtension(
  openShift: ShiftRow, existing: ShiftRow, merged: { start_time: string; end_time: string }
): Promise<ShiftRow> {
  const hasBreak = requiresBreak(merged.start_time, merged.end_time);
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('shifts')
    .update({
      start_time: merged.start_time,
      end_time: merged.end_time,
      has_break: hasBreak,
      break_duration_minutes: hasBreak ? BREAK_DURATION_MINUTES : 0,
      notes: existing.notes ? `${existing.notes} (extended to cover an open shift)` : 'Extended to cover an open shift',
    })
    .eq('id', existing.id)
    .select()
    .single();
  if (updateErr) throw new ExtendError(`Could not extend the shift: ${updateErr.message}`, 500);

  // The open shift's coverage is now folded into the extended one — leaving
  // it around would double-count hours and show as a second, unfilled shift.
  const { error: deleteErr } = await supabaseAdmin.from('shifts').delete().eq('id', openShift.id);
  if (deleteErr) console.error('[extend] could not delete open shift after extending:', deleteErr.message);

  return updated;
}

async function loadOverlap(shiftId: string, staffId: string) {
  const { data: openShift, error: openErr } = await supabaseAdmin
    .from('shifts').select('*').eq('id', shiftId).single();
  if (openErr || !openShift) throw new ExtendError('Shift not found.', 404);
  if (openShift.status !== 'open') throw new ExtendError('This shift is no longer open.', 409);

  const { data: sameDayShifts, error: sameDayErr } = await supabaseAdmin
    .from('shifts').select('*')
    .eq('assigned_staff_id', staffId).eq('date', openShift.date).eq('status', 'covered');
  if (sameDayErr) throw new ExtendError(`Could not read their existing shifts: ${sameDayErr.message}`, 500);

  const overlapping = (sameDayShifts ?? []).filter((s: ShiftRow) =>
    shiftsOverlap(s.start_time, s.end_time, openShift.start_time, openShift.end_time));
  if (overlapping.length === 0) {
    throw new ExtendError('No overlapping shift found for this staff member — nothing to extend.', 409);
  }
  if (overlapping.length > 1) {
    throw new ExtendError('This person has more than one overlapping shift that day — resolve it manually on the Shifts page.', 409);
  }

  const existing = overlapping[0];
  const merged = mergeShiftRanges(existing.start_time, existing.end_time, openShift.start_time, openShift.end_time);

  const otherSameDayShifts = (sameDayShifts ?? []).filter((s: ShiftRow) => s.id !== existing.id);
  if (clashesWithOtherShift(merged.start_time, merged.end_time, otherSameDayShifts)) {
    throw new ExtendError(
      `Extending to ${merged.start_time}–${merged.end_time} would overlap another shift they already have that day.`, 409
    );
  }
  if (shiftDurationMinutes(merged.start_time, merged.end_time) > MAX_EXTENDED_SHIFT_MINUTES) {
    throw new ExtendError(
      `Extending to ${merged.start_time}–${merged.end_time} would exceed the ${MAX_EXTENDED_SHIFT_MINUTES / 60}-hour maximum shift length.`, 409
    );
  }

  return { openShift, existing, merged };
}

/**
 * Everything a click on "Extend their shift" does. Re-derives the overlap
 * from the two IDs rather than trusting times the browser posts back, same
 * as the eligibility engine itself.
 */
export async function requestExtension(
  shiftId: string, staffId: string, startedBy: string | null
): Promise<ExtendOutcome> {
  const { openShift, existing, merged } = await loadOverlap(shiftId, staffId);

  const extendingEarlier = merged.start_time < existing.start_time;
  if (!extendingEarlier) {
    const shift = await applyExtension(openShift, existing, merged);
    return { applied: true, shift };
  }

  const { data: staff } = await supabaseAdmin
    .from('staff').select('name, phone_e164, sms_opt_out').eq('id', staffId).single();
  if (!staff?.phone_e164) throw new ExtendError('This person has no valid mobile number to text.', 409);
  if (staff.sms_opt_out) throw new ExtendError('This person has opted out of SMS — ask them in person instead.', 409);

  const { data: existingPending } = await supabaseAdmin
    .from('shift_extend_requests').select('id').eq('shift_id', shiftId).eq('status', 'pending').maybeSingle();
  if (existingPending) throw new ExtendError('Already asked — waiting on their reply.', 409);

  const { data: dept } = await supabaseAdmin
    .from('departments').select('name').eq('id', existing.department_id).maybeSingle();

  const expiresAt = new Date(Date.now() + getExpiryMinutes() * 60_000).toISOString();
  const { data: request, error: insertErr } = await supabaseAdmin
    .from('shift_extend_requests')
    .insert([{
      shift_id: shiftId, staff_id: staffId, existing_shift_id: existing.id,
      proposed_start_time: merged.start_time, proposed_end_time: merged.end_time,
      started_by: startedBy, expires_at: expiresAt,
    }])
    .select()
    .single();
  if (insertErr) throw new ExtendError(`Could not create the request: ${insertErr.message}`, 500);

  const business = await getBusinessName();
  const body = extendAskMessage(dept?.name ?? 'their department', existing.start_time, merged.start_time, business, null);
  await sendSms({ to: staff.phone_e164, body, kind: 'extend_ask', staffId });

  return { applied: false, pending: true, requestId: request.id };
}

export interface ExtendReplyOutcome {
  handled: true;
  reply: string | null;
  result: 'extend_confirmed' | 'extend_declined' | 'extend_too_late';
  staffId: string;
}

/**
 * Tries to resolve an inbound SMS as a reply to a pending extend-earlier
 * ask. Returns null (not this — fall through to whatever else handles
 * ordinary staff replies) when there's no pending ask for this phone, or
 * the reply isn't a YES/NO.
 */
export async function handleExtendReply(from: string, body: string): Promise<ExtendReplyOutcome | null> {
  const { data: pending } = await supabaseAdmin
    .from('shift_extend_requests')
    .select('*, staff:staff_id ( phone_e164 )')
    .eq('status', 'pending');

  const match = (pending ?? []).find((r: any) => r.staff?.phone_e164 === from);
  if (!match) return null;

  const parsed = parseInboundMessage(body);
  if (parsed.intent !== 'yes' && parsed.intent !== 'no') return null;

  const business = await getBusinessName();

  if (parsed.intent === 'no') {
    const { data: updated } = await supabaseAdmin
      .from('shift_extend_requests')
      .update({ status: 'declined', responded_at: new Date().toISOString() })
      .eq('id', match.id).eq('status', 'pending')
      .select().maybeSingle();
    // Already resolved (expired, or a duplicate reply) — say nothing new.
    if (!updated) return { handled: true, reply: null, result: 'extend_declined', staffId: match.staff_id };
    return { handled: true, reply: declinedMessage(), result: 'extend_declined', staffId: match.staff_id };
  }

  // YES — claim it. The conditional update is the same atomicity guard the
  // claim race uses: only the first reply (or resend) to land wins the row.
  const { data: claimed } = await supabaseAdmin
    .from('shift_extend_requests')
    .update({ status: 'confirmed', responded_at: new Date().toISOString() })
    .eq('id', match.id).eq('status', 'pending')
    .select().maybeSingle();
  if (!claimed) return { handled: true, reply: null, result: 'extend_confirmed', staffId: match.staff_id };

  const [{ data: openShift }, { data: existing }] = await Promise.all([
    supabaseAdmin.from('shifts').select('*').eq('id', claimed.shift_id).maybeSingle(),
    supabaseAdmin.from('shifts').select('*, departments ( name )').eq('id', claimed.existing_shift_id).maybeSingle(),
  ]);

  if (!openShift || !existing || openShift.status !== 'open') {
    // The shift moved on beneath us — cancelled, or covered another way —
    // while this was pending. Tell them honestly rather than silently
    // applying nothing.
    const summary: ShiftSummary | null = existing
      ? { date: existing.date, start_time: claimed.proposed_start_time, end_time: claimed.proposed_end_time, departmentName: existing.departments?.name ?? 'Unknown' }
      : null;
    return {
      handled: true,
      reply: summary ? tooLateMessage(summary, business) : null,
      result: 'extend_too_late',
      staffId: match.staff_id,
    };
  }

  await applyExtension(openShift, existing, { start_time: claimed.proposed_start_time, end_time: claimed.proposed_end_time });
  return {
    handled: true,
    reply: extendConfirmedMessage(claimed.proposed_start_time, business),
    result: 'extend_confirmed',
    staffId: match.staff_id,
  };
}
