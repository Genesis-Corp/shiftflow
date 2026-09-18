import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { findEligibleCandidates, ScoredCandidate } from '@/lib/eligibility';
import {
  generateDistinctCodes, parseInboundMessage, splitContactable, EligibilityIssue,
} from '@/lib/claimRace';
import { parseManagerReply, allocateOptionNumber } from '@/lib/managerReply';
import {
  tierFor, leadMinutesFor, gatherWindowMinutes, nextImmediateAction, nextGatherAction,
  nextSequentialAction, TierRecipient, CoverTier,
  IMMEDIATE_BATCH_SIZE, IMMEDIATE_BATCH_TIMEOUT_MINUTES, SEQUENTIAL_STEP_MINUTES,
} from '@/lib/coverTiers';
import { sendSms, logInbound } from '@/lib/sms/send';
import {
  offerMessage, winnerMessage, coveredMessage, tooLateMessage,
  declinedMessage, optOutMessage, availabilityMessage, availabilityAckMessage,
  managerListMessage, managerOutcomeMessage, managerInvalidPickMessage,
  managerStaleSelectionMessage, ShiftSummary,
} from '@/lib/sms/templates';
import {
  getSmsMode, getExpiryMinutes, getMaxRecipients, isQuietHours, getTimezone,
  localDateNow, localTimeNow,
} from '@/lib/sms/config';

export interface StartRaceResult {
  raceId: string;
  contacted: number;
  excluded: EligibilityIssue[];
  mode: string;
  tier: CoverTier;
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

async function managerProfileFor(userId: string | null): Promise<{ name: string | null; phone_e164: string | null } | null> {
  if (!userId) return null;
  const { data } = await supabaseAdmin
    .from('manager_profiles').select('name, phone_e164').eq('user_id', userId).maybeSingle();
  return data ?? null;
}

/** `count` fresh option numbers for this manager, accounting for every
 *  number already in play across every race currently awaiting their pick —
 *  see managerReply.ts's allocateOptionNumber for why gaps aren't reused. */
async function nextOptionNumbers(managerId: string, count: number): Promise<number[]> {
  const { data: openRaces } = await supabaseAdmin
    .from('shift_claim_races').select('id').eq('started_by', managerId).eq('status', 'awaiting_pick');
  const raceIds = (openRaces ?? []).map(r => r.id);

  let taken: number[] = [];
  if (raceIds.length > 0) {
    const { data: rows } = await supabaseAdmin
      .from('shift_claim_recipients').select('option_number')
      .in('race_id', raceIds).not('option_number', 'is', null);
    taken = (rows ?? []).map(r => r.option_number as number);
  }

  const numbers: number[] = [];
  for (let i = 0; i < count; i++) {
    const n = allocateOptionNumber(taken);
    numbers.push(n);
    taken = [...taken, n];
  }
  return numbers;
}

/** How long a race stays claimable overall — generous enough to cover
 *  whichever tier is running to its natural end, not just the configured
 *  default (which is sized for the simple case). */
function expiryMillisFor(tier: CoverTier, leadMinutes: number, contactableCount: number): number {
  const configuredMs = getExpiryMinutes() * 60_000;
  if (tier === 'immediate') {
    const batches = Math.ceil(contactableCount / IMMEDIATE_BATCH_SIZE);
    return Math.max(configuredMs, batches * IMMEDIATE_BATCH_TIMEOUT_MINUTES * 60_000 + 5 * 60_000);
  }
  if (tier === 'sequential') {
    return Math.max(configuredMs, contactableCount * SEQUENTIAL_STEP_MINUTES * 60_000);
  }
  // gather: the window to collect replies, plus room for the manager to pick
  // afterwards or for a post-window degrade to still be claimable.
  return Math.max(configuredMs, gatherWindowMinutes(leadMinutes) * 60_000 + 30 * 60_000);
}

/** Send the tier's opening message to whichever slice of the ranked,
 *  contactable list is live right now, and record each send's outcome.
 *  `liveSlice` must be a prefix of the full ranked `contactable` list, so
 *  each recipient's index lines up with its claim code in `codes`. */
async function sendToCandidates(
  liveSlice: ScoredCandidate[], codes: string[], summary: ShiftSummary,
  raceId: string, tier: CoverTier, managerName: string | null
): Promise<number> {
  const results = await Promise.allSettled(
    liveSlice.map((c, i) => sendSms({
      to: c.phone_e164!,
      body: tier === 'gather' ? availabilityMessage(summary, managerName) : offerMessage(summary, codes[i], managerName),
      kind: tier === 'gather' ? 'availability' : 'offer',
      raceId,
      staffId: c.id,
      recipientName: c.name,
    }))
  );

  await Promise.all(results.map((r, i) => {
    const ok = r.status === 'fulfilled' && r.value.ok;
    const error = r.status === 'rejected' ? String(r.reason) : (r.value.error ?? null);
    return supabaseAdmin.from('shift_claim_recipients').update({
      send_status: ok ? 'sent' : 'failed',
      send_error: error,
      provider_sid: r.status === 'fulfilled' ? r.value.providerSid : null,
    }).eq('race_id', raceId).eq('staff_id', liveSlice[i].id);
  }));

  return results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
}

/**
 * Start a claim race for an open shift.
 *
 * Eligibility is recomputed here rather than taken from the request, so the
 * recipient list cannot be influenced by the browser. How the race is run —
 * blasting everyone, gathering replies for the manager to pick from, or
 * working down the list one at a time — is decided by how much notice there
 * is (see coverTiers.ts's tierFor), not chosen by whoever clicks the button.
 * Every candidate gets a recipient row up front, in ranked (cheapest first)
 * order; only the tier's currently "live" slice is actually texted right
 * away; the rest advance later via advanceRace().
 */
export async function startRace(
  shiftId: string, opts: { force?: boolean; startedBy?: string } = {}
): Promise<StartRaceResult> {
  const shift = await loadShift(shiftId);

  if (shift.status !== 'open') {
    throw new RaceError(`Shift is ${shift.status}, not open — nothing to cover.`);
  }

  const leadMinutes = leadMinutesFor(shift.date, shift.start_time, localDateNow(), localTimeNow());
  const tier = tierFor(leadMinutes);

  // The immediate tier is the no-show case — there is no time to respect
  // quiet hours, someone has to be woken up. Gather and sequential can wait.
  if (tier !== 'immediate' && isQuietHours() && !opts.force) {
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
  const now = Date.now();
  const expiresAt = new Date(now + expiryMillisFor(tier, leadMinutes, contactable.length));

  const manager = await managerProfileFor(opts.startedBy ?? null);
  const managerName = manager?.name ?? null;

  // Avoid reusing a code that another in-flight race is relying on.
  const { data: liveCodes } = await supabaseAdmin
    .from('shift_claim_recipients').select('claim_code').is('outcome', null);
  const codes = generateDistinctCodes(
    contactable.length, (liveCodes ?? []).map(r => r.claim_code)
  );

  const tierColumns =
    tier === 'immediate' ? {
      current_batch: 0,
      batch_deadline: new Date(now + IMMEDIATE_BATCH_TIMEOUT_MINUTES * 60_000).toISOString(),
    } :
    tier === 'sequential' ? {
      sequential_index: 0,
      step_deadline: new Date(now + SEQUENTIAL_STEP_MINUTES * 60_000).toISOString(),
    } :
    { gather_deadline: new Date(now + gatherWindowMinutes(leadMinutes) * 60_000).toISOString() };

  const { data: race, error: raceErr } = await supabaseAdmin
    .from('shift_claim_races')
    .insert([{
      shift_id: shiftId, status: 'active', mode, tier,
      expires_at: expiresAt.toISOString(), started_by: opts.startedBy ?? null,
      ...tierColumns,
    }])
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
      shift_cost: c.shift_cost,
      phone_e164: c.phone_e164,
      send_status: 'queued',
      outcome: null,
      is_available: null,
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

  // How much of the ranked list is actually texted right now: immediate asks
  // its first batch, sequential asks only the first (cheapest) person,
  // gather asks everyone at once. `contactable` is already rank-ordered
  // (cheapest first, from findEligibleCandidates -> rankCandidates), so a
  // plain prefix slice keeps each candidate's `codes` index correct.
  const liveSlice =
    tier === 'immediate' ? contactable.slice(0, IMMEDIATE_BATCH_SIZE) :
    tier === 'sequential' ? contactable.slice(0, 1) :
    contactable;

  const contacted = await sendToCandidates(liveSlice, codes, summary, race.id, tier, managerName);
  return { raceId: race.id, contacted, excluded, mode, tier };
}

interface RecipientRow {
  id: string;
  staff_id: string;
  claim_code: string;
  phone_e164: string | null;
  outcome: 'won' | 'lost' | 'declined' | 'no_response' | null;
  is_available: boolean | null;
  shift_cost: number | null;
  staff?: { name: string } | null;
}

/** Send an offer (claim code, "first reply wins") to a set of recipients
 *  already in the database, reusing each one's own claim code. Used to
 *  advance the immediate tier to its next batch, the sequential tier to its
 *  next person, and to send the gather tier's post-window degrade blast. */
async function sendOfferBatch(
  rows: RecipientRow[], summary: ShiftSummary, raceId: string, managerName: string | null
): Promise<void> {
  const sendable = rows.filter(r => r.phone_e164);
  if (sendable.length === 0) return;

  const results = await Promise.allSettled(
    sendable.map(r => sendSms({
      to: r.phone_e164!,
      body: offerMessage(summary, r.claim_code, managerName),
      kind: 'offer',
      raceId, staffId: r.staff_id, recipientName: r.staff?.name,
    }))
  );

  await Promise.all(results.map((r, i) => {
    const ok = r.status === 'fulfilled' && r.value.ok;
    const error = r.status === 'rejected' ? String(r.reason) : (r.value.error ?? null);
    return supabaseAdmin.from('shift_claim_recipients').update({
      send_status: ok ? 'sent' : 'failed',
      send_error: error,
      provider_sid: r.status === 'fulfilled' ? r.value.providerSid : null,
    }).eq('race_id', raceId).eq('staff_id', sendable[i].staff_id);
  }));
}

/** The manager's outcome-only text for the immediate and sequential tiers —
 *  nothing for them to decide, just what happened. Silently does nothing if
 *  the race has no starting manager on file, or that manager has no phone. */
async function notifyManagerOutcome(
  race: { id: string; started_by: string | null }, summary: ShiftSummary, winnerName: string | null
): Promise<void> {
  const manager = await managerProfileFor(race.started_by);
  if (!manager?.phone_e164) return;
  await sendSms({
    to: manager.phone_e164,
    body: managerOutcomeMessage(summary, winnerName),
    kind: 'manager_outcome',
    raceId: race.id, staffId: null, recipientName: manager.name ?? undefined,
  });
}

/**
 * The lazy tier-advance step — called before a race is read (getRaceDetail)
 * and before an inbound reply is matched (handleInboundReply), the same
 * "check on the way past" pattern expireIfDue already uses for overall
 * expiry. There is no cron in this app; every timing rule here fires the
 * next time someone looks at or replies to the race, which is normal for a
 * cover request someone is actively watching.
 *
 * Every DB write that has an irreversible side effect (sending an SMS) is
 * gated on a conditional UPDATE whose result is checked before acting —
 * `.update(...).eq(<still-in-the-state-this-decision-was-based-on>).select()`
 * returning no row means someone else (a concurrent poll, or a reply landing
 * at the same moment) already made this exact transition, so this call backs
 * off rather than sending the same message twice.
 */
export async function advanceRace(raceId: string): Promise<void> {
  const { data: race } = await supabaseAdmin.from('shift_claim_races').select('*').eq('id', raceId).single();
  if (!race || race.status !== 'active') return;

  const { data: rows } = await supabaseAdmin
    .from('shift_claim_recipients')
    .select('id, staff_id, claim_code, phone_e164, outcome, is_available, shift_cost, rank, staff ( name )')
    .eq('race_id', raceId)
    .not('rank', 'is', null)
    .order('rank', { ascending: true });
  const recipients = (rows ?? []) as unknown as (RecipientRow & { rank: number })[];
  if (recipients.length === 0) return;

  const tierRecipients: TierRecipient[] = recipients.map(r => ({
    staffId: r.staff_id, outcome: r.outcome, isAvailable: r.is_available,
  }));
  const now = new Date();

  if (race.tier === 'immediate') {
    await advanceImmediate(race, recipients, tierRecipients, now);
  } else if (race.tier === 'gather') {
    await advanceGather(race, recipients, tierRecipients, now);
  } else {
    await advanceSequential(race, recipients, tierRecipients, now);
  }
}

async function advanceImmediate(
  race: { id: string; shift_id: string; started_by: string | null; current_batch: number | null; batch_deadline: string },
  recipients: RecipientRow[], tierRecipients: TierRecipient[], now: Date
): Promise<void> {
  const currentBatch = race.current_batch ?? 0;
  const action = nextImmediateAction(tierRecipients, currentBatch, new Date(race.batch_deadline), now);
  if (action.type === 'wait') return;

  const shift = await loadShift(race.shift_id);
  const summary = toSummary(shift);

  if (action.type === 'exhausted') {
    const { data: updated } = await supabaseAdmin.from('shift_claim_races')
      .update({ status: 'expired' }).eq('id', race.id).eq('status', 'active').select().maybeSingle();
    if (!updated) return;
    await supabaseAdmin.from('shift_claim_recipients')
      .update({ outcome: 'no_response' }).eq('race_id', race.id).is('outcome', null);
    await notifyManagerOutcome(race, summary, null);
    return;
  }

  const { data: updated } = await supabaseAdmin.from('shift_claim_races').update({
    current_batch: action.batchIndex,
    batch_deadline: new Date(now.getTime() + IMMEDIATE_BATCH_TIMEOUT_MINUTES * 60_000).toISOString(),
  }).eq('id', race.id).eq('status', 'active').eq('current_batch', currentBatch).select().maybeSingle();
  if (!updated) return; // someone else already advanced this batch

  const manager = await managerProfileFor(race.started_by);
  const toSend = recipients.filter(r => action.recipients.some(a => a.staffId === r.staff_id));
  await sendOfferBatch(toSend, summary, race.id, manager?.name ?? null);
}

async function advanceGather(
  race: { id: string; shift_id: string; started_by: string | null; gather_deadline: string; degraded_at: string | null },
  recipients: RecipientRow[], tierRecipients: TierRecipient[], now: Date
): Promise<void> {
  if (race.degraded_at) return; // already switched to first-yes-wins; nothing left for this step to do

  const action = nextGatherAction(tierRecipients, new Date(race.gather_deadline), now);
  if (action.type === 'wait') return;

  const shift = await loadShift(race.shift_id);
  const summary = toSummary(shift);

  if (action.type === 'notify_manager') {
    const ranked = recipients.filter(r => action.available.some(a => a.staffId === r.staff_id));

    const { data: updated } = await supabaseAdmin.from('shift_claim_races')
      .update({ status: 'awaiting_pick' }).eq('id', race.id).eq('status', 'active').select().maybeSingle();
    if (!updated) return; // someone else already closed this window

    // Numbered globally per manager, not restarted at 1 for this race — if
    // she has another race also awaiting a pick right now, a number can
    // still only mean one specific person (see managerReply.ts).
    const numbers = race.started_by ? await nextOptionNumbers(race.started_by, ranked.length) : ranked.map((_, i) => i + 1);
    await Promise.all(ranked.map((r, i) =>
      supabaseAdmin.from('shift_claim_recipients').update({ option_number: numbers[i] }).eq('id', r.id)
    ));

    const manager = await managerProfileFor(race.started_by);
    if (!manager?.phone_e164) return;
    const options = ranked.map((r, i) => ({ option: numbers[i], name: r.staff?.name ?? 'Unknown', cost: r.shift_cost }));
    await sendSms({
      to: manager.phone_e164,
      body: managerListMessage(summary, options),
      kind: 'manager_list',
      raceId: race.id, staffId: null, recipientName: manager.name ?? undefined,
    });
    return;
  }

  // degrade: nobody was available, so switch to first-yes-wins for whoever
  // hasn't explicitly declined. Race stays 'active' and tier stays 'gather'
  // — degraded_at is the only record that this happened.
  const { data: updated } = await supabaseAdmin.from('shift_claim_races')
    .update({ degraded_at: now.toISOString() })
    .eq('id', race.id).eq('status', 'active').is('degraded_at', null).select().maybeSingle();
  if (!updated) return;

  const manager = await managerProfileFor(race.started_by);
  const toSend = recipients.filter(r => action.recipients.some(a => a.staffId === r.staff_id));
  await sendOfferBatch(toSend, summary, race.id, manager?.name ?? null);
}

async function advanceSequential(
  race: { id: string; shift_id: string; started_by: string | null; sequential_index: number | null; step_deadline: string },
  recipients: RecipientRow[], tierRecipients: TierRecipient[], now: Date
): Promise<void> {
  const currentIndex = race.sequential_index ?? 0;
  const action = nextSequentialAction(tierRecipients, currentIndex, new Date(race.step_deadline), now);
  if (action.type === 'wait') return;

  const shift = await loadShift(race.shift_id);
  const summary = toSummary(shift);

  if (action.type === 'exhausted') {
    const { data: updated } = await supabaseAdmin.from('shift_claim_races')
      .update({ status: 'expired' }).eq('id', race.id).eq('status', 'active').select().maybeSingle();
    if (!updated) return;
    await supabaseAdmin.from('shift_claim_recipients')
      .update({ outcome: 'no_response' }).eq('race_id', race.id).is('outcome', null);
    await notifyManagerOutcome(race, summary, null);
    return;
  }

  const { data: updated } = await supabaseAdmin.from('shift_claim_races').update({
    sequential_index: action.index,
    step_deadline: new Date(now.getTime() + SEQUENTIAL_STEP_MINUTES * 60_000).toISOString(),
  }).eq('id', race.id).eq('status', 'active').eq('sequential_index', currentIndex).select().maybeSingle();
  if (!updated) return; // someone else already advanced this step

  const manager = await managerProfileFor(race.started_by);
  const next = recipients.find(r => r.staff_id === action.recipient.staffId);
  if (next) await sendOfferBatch([next], summary, race.id, manager?.name ?? null);
}

export interface ReplyOutcome {
  handled: boolean;
  reply: string | null;      // message to send back to the sender
  result:
    | 'won' | 'too_late' | 'declined' | 'opted_out' | 'unmatched' | 'duplicate'
    | 'available_ack' | 'manager_picked' | 'manager_invalid_pick' | 'manager_stale_pick';
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

  // A manager's own phone replying with a number, picking from the list they
  // were sent for the gather tier. Checked first since it's a completely
  // separate path from staff replies — a manager's phone is never also a
  // staff member's phone_e164 in practice, but keeping this ahead of the
  // recipient lookup means it can never be shadowed by a coincidental match.
  const managerPick = await handleManagerPick(from, body);
  if (managerPick) return managerPick;

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

  // The gather tier, still within its window: a YES only records that this
  // person is available — the manager who started the race picks, so this
  // does not win them the shift. Once the window has closed (degraded_at
  // set, or simply past gather_deadline), a YES falls through to the normal
  // atomic claim below, which is exactly the "degrades to first yes wins"
  // behaviour advanceRace's gather step already switched the race into.
  if (race.tier === 'gather' && !race.degraded_at && new Date() < new Date(race.gather_deadline)) {
    await supabaseAdmin.from('shift_claim_recipients').update({
      is_available: true, responded_at: new Date().toISOString(), response_body: body,
    }).eq('id', recipient.id);
    return {
      handled: true, reply: availabilityAckMessage(), result: 'available_ack',
      raceId: race.id, staffId: recipient.staff_id,
    };
  }

  // The atomic claim. Postgres serialises this UPDATE at row level, so of two
  // simultaneous YES replies exactly one gets a row back.
  const { data: claimed } = await supabaseAdmin
    .rpc('claim_shift_race', { p_race_id: race.id, p_staff_id: recipient.staff_id });

  // The function is SETOF, so a loss is an empty array. The id check is a
  // second line of defence: if the function were ever redefined without SETOF,
  // a loss would arrive as a single row of NULLs, which is truthy — and every
  // late replier would be told they had won the shift.
  const claimedRows = Array.isArray(claimed) ? claimed : claimed ? [claimed] : [];
  const won = claimedRows.some((row: { id?: string | null }) => !!row?.id);

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

  // The manager finds out here, not just when nobody's available — a staff
  // YES resolving the race (immediate, sequential, or gather post-degrade)
  // is exactly the "who accepted" half of the outcome-only notification
  // requested for those tiers. The manager's own pick (handleManagerPick)
  // already confirms itself in that reply, so it doesn't duplicate this.
  await notifyManagerOutcome(race, summary, staff?.name ?? null);

  return {
    handled: true,
    reply: winnerMessage(summary, staff?.name ?? 'there'),
    result: 'won',
    raceId: race.id,
    staffId: recipient.staff_id,
  };
}

/**
 * Resolve an inbound SMS as a manager's numbered pick, if that's what it is.
 * Returns null (not a manager pick — fall through to ordinary staff-reply
 * handling) whenever the sender isn't a manager with a race waiting on them,
 * or the message doesn't parse as a single, unambiguous number.
 *
 * Option numbers are allocated globally per manager (see managerReply.ts's
 * allocateOptionNumber), not restarted at 1 per race, so if this manager
 * somehow has two races awaiting a pick at once, "2" still means one specific
 * person on one specific race rather than being ambiguous between them.
 *
 * The claim itself is a plain conditional UPDATE rather than the
 * claim_shift_race RPC — that function only matches status = 'active', and a
 * race waiting on a manager's pick is 'awaiting_pick'. The same row-level
 * serialisation Postgres gives any UPDATE means this is exactly as atomic
 * against a manager double-texting a number as the RPC is against two
 * staff replying at once; it just targets a different status.
 */
async function handleManagerPick(from: string, body: string): Promise<ReplyOutcome | null> {
  const { data: manager } = await supabaseAdmin
    .from('manager_profiles').select('user_id').eq('phone_e164', from).maybeSingle();
  if (!manager) return null;

  const { data: races } = await supabaseAdmin
    .from('shift_claim_races')
    .select('id, shift_id')
    .eq('started_by', manager.user_id)
    .eq('status', 'awaiting_pick');
  if (!races || races.length === 0) return null;

  const intent = parseManagerReply(body);
  if (intent.kind !== 'select') return null; // not an unambiguous number — leave it to ordinary handling

  const raceIds = races.map(r => r.id);
  const { data: recipient } = await supabaseAdmin
    .from('shift_claim_recipients')
    .select('id, race_id, staff_id, outcome')
    .in('race_id', raceIds).eq('option_number', intent.option).maybeSingle();

  if (!recipient || recipient.outcome !== null) {
    return { handled: true, reply: managerInvalidPickMessage(), result: 'manager_invalid_pick' };
  }

  const race = races.find(r => r.id === recipient.race_id)!;
  const { data: shift } = await supabaseAdmin
    .from('shifts').select(`*, departments ( id, name )`).eq('id', race.shift_id).single();
  const summary = toSummary(shift);

  const { data: won } = await supabaseAdmin
    .from('shift_claim_races')
    .update({ winner_staff_id: recipient.staff_id, status: 'claimed', claimed_at: new Date().toISOString() })
    .eq('id', race.id).eq('status', 'awaiting_pick').is('winner_staff_id', null)
    .select().maybeSingle();

  if (!won) {
    return { handled: true, reply: managerStaleSelectionMessage(), result: 'manager_stale_pick', raceId: race.id };
  }

  await onRaceWon(race.id, recipient.id, recipient.staff_id, shift, summary, body);

  const { data: staffRow } = await supabaseAdmin.from('staff').select('name').eq('id', recipient.staff_id).single();
  return {
    handled: true,
    reply: managerOutcomeMessage(summary, staffRow?.name ?? 'them'),
    result: 'manager_picked',
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
  await advanceRace(raceId);
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
