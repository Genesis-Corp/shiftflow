import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { findEligibleCandidates } from '@/lib/eligibility';
import {
  generateDistinctCodes, parseInboundMessage, splitContactable, EligibilityIssue,
} from '@/lib/claimRace';
import { sendSms, logInbound } from '@/lib/sms/send';
import {
  offerMessage, winnerMessage, coveredMessage, tooLateMessage,
  declinedMessage, optOutMessage, ShiftSummary,
} from '@/lib/sms/templates';
import {
  getSmsMode, getExpiryMinutes, getMaxRecipients, isQuietHours, getTimezone,
} from '@/lib/sms/config';

export interface StartRaceResult {
  raceId: string;
  contacted: number;
  excluded: EligibilityIssue[];
  mode: string;
}

export class RaceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

async function loadShift(shiftId: string) {
  const { data, error } = await supabaseAdmin
    .from('shifts')
    .select(`*, departments ( id, name, requires_supervisor )`)
    .eq('id', shiftId)
    .single();
  if (error || !data) throw new RaceError('Shift not found', 404);
  return data;
}

function toSummary(shift: {
  date: string; start_time: string; end_time: string;
  departments?: { name: string } | null;
}): ShiftSummary {
  return {
    date: shift.date,
    start_time: shift.start_time,
    end_time: shift.end_time,
    departmentName: shift.departments?.name ?? 'Unknown',
  };
}

/**
 * Start a claim race for an open shift.
 *
 * Eligibility is recomputed here rather than taken from the request, so the
 * recipient list cannot be influenced by the browser.
 */
export async function startRace(
  shiftId: string, opts: { force?: boolean } = {}
): Promise<StartRaceResult> {
  const shift = await loadShift(shiftId);

  if (shift.status !== 'open') {
    throw new RaceError(`Shift is ${shift.status}, not open — nothing to cover.`);
  }

  if (isQuietHours() && !opts.force) {
    throw new RaceError(
      `It is currently quiet hours in ${getTimezone()}. Re-send with force to override.`
    );
  }

  const { data: existing } = await supabaseAdmin
    .from('shift_claim_races')
    .select('id').eq('shift_id', shiftId).eq('status', 'active').maybeSingle();
  if (existing) {
    throw new RaceError('A claim race is already running for this shift.', 409);
  }

  const { candidates } = await findEligibleCandidates({
    date: shift.date,
    start_time: shift.start_time,
    end_time: shift.end_time,
    department_id: shift.department_id,
    required_role: shift.required_role,
  });

  const { contactable, excluded } = splitContactable(candidates);
  if (contactable.length === 0) {
    throw new RaceError(
      'No eligible staff with a valid mobile number. Check availability and phone numbers.'
    );
  }

  const max = getMaxRecipients();
  if (contactable.length > max) {
    throw new RaceError(
      `${contactable.length} staff match, above the SMS_MAX_RECIPIENTS cap of ${max}.`
    );
  }

  const mode = getSmsMode();
  const expiresAt = new Date(Date.now() + getExpiryMinutes() * 60_000);

  // Avoid reusing a code that another in-flight race is relying on.
  const { data: liveCodes } = await supabaseAdmin
    .from('shift_claim_recipients').select('claim_code').is('outcome', null);
  const codes = generateDistinctCodes(
    contactable.length, (liveCodes ?? []).map(r => r.claim_code)
  );

  const { data: race, error: raceErr } = await supabaseAdmin
    .from('shift_claim_races')
    .insert([{ shift_id: shiftId, status: 'active', mode, expires_at: expiresAt.toISOString() }])
    .select().single();
  // 23505 here is the one-active-race-per-shift index: two managers clicked at
  // the same moment, and the second one loses.
  if (raceErr) {
    if ((raceErr as { code?: string }).code === '23505') {
      throw new RaceError('A claim race is already running for this shift.', 409);
    }
    throw new RaceError(raceErr.message, 500);
  }

  const { error: recErr } = await supabaseAdmin.from('shift_claim_recipients').insert(
    contactable.map((c, i) => ({
      race_id: race.id,
      staff_id: c.id,
      claim_code: codes[i],
      rank: i + 1,
      computed_score: c.computed_score,
      phone_e164: c.phone_e164,
      send_status: 'queued',
    }))
  );
  if (recErr) throw new RaceError(recErr.message, 500);

  // Record the people we could not reach, so the manager sees them on the
  // race view rather than only in the confirmation dialog they already closed.
  if (excluded.length > 0) {
    await supabaseAdmin.from('shift_claim_recipients').insert(
      excluded.map(e => ({
        race_id: race.id,
        staff_id: e.staffId,
        claim_code: `X-${e.staffId.slice(0, 6)}`,
        phone_e164: null,
        send_status: e.reason === 'opted_out' ? 'skipped_opted_out' : 'skipped_no_phone',
        outcome: 'no_response',
      }))
    );
  }

  const summary = toSummary(shift);

  // Send concurrently — a 10-person race is ~10 API calls and a serial loop
  // would put the manager on a spinner for several seconds.
  const results = await Promise.allSettled(
    contactable.map((c, i) => sendSms({
      to: c.phone_e164!,
      body: offerMessage(summary, codes[i]),
      kind: 'offer',
      raceId: race.id,
      staffId: c.id,
      recipientName: c.name,
    }))
  );

  await Promise.all(results.map((r, i) => {
    const ok = r.status === 'fulfilled' && r.value.ok;
    const error = r.status === 'rejected'
      ? String(r.reason)
      : (r.value.error ?? null);
    return supabaseAdmin.from('shift_claim_recipients').update({
      send_status: ok ? 'sent' : 'failed',
      send_error: error,
      provider_sid: r.status === 'fulfilled' ? r.value.providerSid : null,
    }).eq('race_id', race.id).eq('staff_id', contactable[i].id);
  }));

  const contacted = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
  return { raceId: race.id, contacted, excluded, mode };
}

export interface ReplyOutcome {
  handled: boolean;
  reply: string | null;      // message to send back to the sender
  result: 'won' | 'too_late' | 'declined' | 'opted_out' | 'unmatched' | 'duplicate';
  raceId?: string;
  staffId?: string;
}

/**
 * Handle one inbound SMS. Shared by the Twilio webhook and the simulator, so
 * a simulated reply exercises exactly the production path.
 */
export async function handleInboundReply(params: {
  from: string; body: string; to?: string | null; providerSid?: string | null;
}): Promise<ReplyOutcome> {
  const { from, body } = params;

  const fresh = await logInbound({
    from, to: params.to, body, providerSid: params.providerSid,
  });
  if (!fresh) return { handled: false, reply: null, result: 'duplicate' };

  const parsed = parseInboundMessage(body);

  // Match on the claim code first: it survives a staff member texting from a
  // different handset, and it is the only thing that works in redirect mode
  // where every test reply arrives from the same number.
  let recipient: {
    id: string; race_id: string; staff_id: string; outcome: string | null;
  } | null = null;

  if (parsed.code) {
    const { data } = await supabaseAdmin
      .from('shift_claim_recipients')
      .select('id, race_id, staff_id, outcome')
      .eq('claim_code', parsed.code)
      .is('outcome', null)
      .maybeSingle();
    recipient = data ?? null;
  }

  if (!recipient) {
    const { data } = await supabaseAdmin
      .from('shift_claim_recipients')
      .select('id, race_id, staff_id, outcome, created_at')
      .eq('phone_e164', from)
      .is('outcome', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    recipient = data ?? null;
  }

  if (parsed.intent === 'stop') {
    const staffId = recipient?.staff_id ?? await staffIdForPhone(from);
    if (staffId) await supabaseAdmin.from('staff').update({ sms_opt_out: true }).eq('id', staffId);
    return { handled: true, reply: optOutMessage(), result: 'opted_out', staffId: staffId ?? undefined };
  }

  if (!recipient) return { handled: true, reply: null, result: 'unmatched' };

  const { data: race } = await supabaseAdmin
    .from('shift_claim_races').select('*').eq('id', recipient.race_id).single();
  if (!race) return { handled: true, reply: null, result: 'unmatched' };

  const { data: shift } = await supabaseAdmin
    .from('shifts')
    .select(`*, departments ( id, name )`)
    .eq('id', race.shift_id).single();
  const summary = toSummary(shift);

  if (parsed.intent === 'no') {
    await supabaseAdmin.from('shift_claim_recipients').update({
      outcome: 'declined', responded_at: new Date().toISOString(), response_body: body,
    }).eq('id', recipient.id);
    return {
      handled: true, reply: declinedMessage(), result: 'declined',
      raceId: race.id, staffId: recipient.staff_id,
    };
  }

  if (parsed.intent !== 'yes') {
    return { handled: true, reply: null, result: 'unmatched', raceId: race.id };
  }

  // The atomic claim. Postgres serialises this UPDATE at row level, so of two
  // simultaneous YES replies exactly one gets a row back.
  const { data: claimed } = await supabaseAdmin
    .rpc('claim_shift_race', { p_race_id: race.id, p_staff_id: recipient.staff_id });

  const won = Array.isArray(claimed) ? claimed.length > 0 : !!claimed;

  if (!won) {
    await supabaseAdmin.from('shift_claim_recipients').update({
      outcome: 'lost', responded_at: new Date().toISOString(), response_body: body,
    }).eq('id', recipient.id);
    return {
      handled: true, reply: tooLateMessage(summary), result: 'too_late',
      raceId: race.id, staffId: recipient.staff_id,
    };
  }

  await onRaceWon(race.id, recipient.id, recipient.staff_id, shift, summary, body);

  const { data: staff } = await supabaseAdmin
    .from('staff').select('name').eq('id', recipient.staff_id).single();

  return {
    handled: true,
    reply: winnerMessage(summary, staff?.name ?? 'there'),
    result: 'won',
    raceId: race.id,
    staffId: recipient.staff_id,
  };
}

/** Everything that follows a successful claim. */
async function onRaceWon(
  raceId: string, recipientId: string, staffId: string,
  shift: { id: string; date: string }, summary: ShiftSummary, body: string
) {
  await supabaseAdmin.from('shift_claim_recipients').update({
    outcome: 'won', responded_at: new Date().toISOString(), response_body: body,
  }).eq('id', recipientId);

  await supabaseAdmin.from('shifts').update({
    status: 'covered', assigned_staff_id: staffId,
  }).eq('id', shift.id);

  // Credit the winner (+10). Declines and silence are deliberately NOT scored
  // automatically — turning down an optional extra shift shouldn't quietly
  // damage someone's reliability. The manual buttons remain for judgement calls.
  await supabaseAdmin.from('reliability_incidents').insert([{
    staff_id: staffId, incident_type: 'covered', shift_id: shift.id,
    date: shift.date, notes: 'Claimed via SMS claim race',
  }]);
  const { data: staffRow } = await supabaseAdmin
    .from('staff').select('reliability_score').eq('id', staffId).single();
  await supabaseAdmin.from('staff').update({
    reliability_score: Math.min(100, (staffRow?.reliability_score ?? 50) + 10),
  }).eq('id', staffId);

  // Tell everyone else. Anyone who already declined is skipped — they have
  // opted out of caring, and it saves a message.
  const { data: others } = await supabaseAdmin
    .from('shift_claim_recipients')
    .select('id, staff_id, phone_e164, outcome, send_status')
    .eq('race_id', raceId)
    .neq('id', recipientId);

  const toNotify = (others ?? []).filter(
    r => r.phone_e164 && r.send_status === 'sent' && r.outcome !== 'declined'
  );

  const names = await staffNames(toNotify.map(r => r.staff_id));

  await Promise.allSettled(toNotify.map(r => sendSms({
    to: r.phone_e164!,
    body: coveredMessage(summary),
    kind: 'covered',
    raceId,
    staffId: r.staff_id,
    recipientName: names.get(r.staff_id),
  })));

  await supabaseAdmin.from('shift_claim_recipients').update({ outcome: 'no_response' })
    .eq('race_id', raceId).is('outcome', null);
}

async function staffNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabaseAdmin.from('staff').select('id, name').in('id', ids);
  return new Map((data ?? []).map(s => [s.id, s.name]));
}

async function staffIdForPhone(phone: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('staff').select('id').eq('phone_e164', phone).maybeSingle();
  return data?.id ?? null;
}

/** Mark a race expired if its deadline has passed. Called lazily on read. */
export async function expireIfDue(raceId: string): Promise<void> {
  const { data: race } = await supabaseAdmin
    .from('shift_claim_races').select('*').eq('id', raceId).single();
  if (!race || race.status !== 'active') return;
  if (new Date(race.expires_at).getTime() > Date.now()) return;

  await supabaseAdmin.from('shift_claim_races')
    .update({ status: 'expired' }).eq('id', raceId).eq('status', 'active');
  await supabaseAdmin.from('shift_claim_recipients')
    .update({ outcome: 'no_response' }).eq('race_id', raceId).is('outcome', null);
}

export async function cancelRace(raceId: string): Promise<void> {
  const { data: race } = await supabaseAdmin
    .from('shift_claim_races').select('status').eq('id', raceId).single();
  if (!race) throw new RaceError('Race not found', 404);
  if (race.status !== 'active') throw new RaceError(`Race is already ${race.status}.`);

  await supabaseAdmin.from('shift_claim_races').update({
    status: 'cancelled', cancelled_at: new Date().toISOString(),
  }).eq('id', raceId).eq('status', 'active');
  await supabaseAdmin.from('shift_claim_recipients')
    .update({ outcome: 'no_response' }).eq('race_id', raceId).is('outcome', null);
}

/** Full race detail for the status panel. */
export async function getRaceDetail(raceId: string) {
  await expireIfDue(raceId);

  const { data: race, error } = await supabaseAdmin
    .from('shift_claim_races')
    .select(`*, shifts ( id, date, start_time, end_time, status, departments ( id, name ) )`)
    .eq('id', raceId).single();
  if (error || !race) throw new RaceError('Race not found', 404);

  const { data: recipients } = await supabaseAdmin
    .from('shift_claim_recipients')
    .select(`*, staff ( id, name, age_group, reliability_score )`)
    .eq('race_id', raceId)
    .order('rank', { ascending: true, nullsFirst: false });

  const { data: messages } = await supabaseAdmin
    .from('sms_messages')
    .select('*').eq('race_id', raceId).order('created_at', { ascending: true });

  return { race, recipients: recipients ?? [], messages: messages ?? [] };
}
