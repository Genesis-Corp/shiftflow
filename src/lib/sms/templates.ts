import { getTimezone, localDateNow } from './config';
import { addDays } from '@/lib/shiftUtils';
import { isGsm7, smsSegments } from './segments';

export { isGsm7, smsSegments };

/**
 * Message copy.
 *
 * No message shows a claim code or promises "first reply wins" — every tier
 * reads the same plain availability ask (see availabilityMessage and
 * urgentAvailabilityMessage below); a YES still resolves fairly through the
 * atomic claim behind the scenes, the recipient just never sees the
 * mechanics. The Spam Act 2003 expects the sender to be identifiable and to
 * offer a free opt-out, so the business name leads and STOP is offered on
 * both of those — the only messages a recipient can receive without having
 * opted in to a race.
 *
 * Every staff-facing message takes the store's name as an explicit
 * `business` parameter rather than reading a module-level constant — it
 * comes from the store's own Settings (see sms/config.ts's
 * getBusinessName()), which only a DB read can answer, so the caller
 * resolves it once per operation and passes it down.
 */

export interface ShiftSummary {
  date: string;        // YYYY-MM-DD
  start_time: string;  // HH:MM[:SS]
  end_time: string;    // HH:MM[:SS]
  departmentName: string;
}

/** "Today", "Tomorrow", or "Mon 15 Sep" in the configured timezone — relative
 *  to `nowDate` (defaults to the real current date), so a shift created for
 *  today or tomorrow reads unambiguously instead of making the reader check
 *  a weekday against today's date. */
export function formatShiftDate(date: string, nowDate: string = localDateNow()): string {
  if (date === nowDate) return 'Today';
  if (date === addDays(nowDate, 1)) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: getTimezone(), weekday: 'short', day: 'numeric', month: 'short',
  }).format(new Date(`${date}T00:00:00`));
}

/** "09:00-17:00" — trims the seconds Postgres returns on a `time` column. */
export function formatShiftTimes(start: string, end: string): string {
  return `${start.slice(0, 5)}-${end.slice(0, 5)}`;
}

export function describeShift(shift: ShiftSummary, nowDate: string = localDateNow()): string {
  return `${formatShiftDate(shift.date, nowDate)} ${formatShiftTimes(shift.start_time, shift.end_time)}, ${shift.departmentName}`;
}

/** Sent to the winner, confirming the shift is theirs. */
export function winnerMessage(shift: ShiftSummary, name: string, business: string): string {
  return `${business}: thanks ${name}, the ${describeShift(shift)} shift is yours. See you then.`;
}

/** Broadcast to everyone else the moment the race is won. */
export function coveredMessage(shift: ShiftSummary, business: string): string {
  return `${business}: the ${describeShift(shift)} shift has now been covered. Thanks!`;
}

/**
 * Sent when a YES arrives after the race is already won — the staff member
 * whose phone was off, or who replied a second too late. Without this they
 * get silence after an explicit action, and may turn up to the shift.
 */
export function tooLateMessage(shift: ShiftSummary, business: string): string {
  return `${business}: sorry, the ${describeShift(shift)} shift has already been covered by someone else.`;
}

/** Acknowledges an explicit NO, so the reply isn't met with silence. */
export function declinedMessage(business: string): string {
  return `${business}: no worries, thanks for letting us know.`;
}

/** Confirms an opt-out. */
export function optOutMessage(business: string): string {
  return `${business}: you will not receive any more shift messages from us.`;
}

/** Confirms an opt-back-in, e.g. after a reply of START. */
export function optInMessage(business: string): string {
  return `${business}: you're back on the list and will receive shift messages again.`;
}

// ── Message Board (manager broadcast) ───────────────────────────────────────
// A manager-authored update, not part of any opt-in shift-offer race, so it
// must independently carry the Spam Act 2003 requirements every other
// non-race message here does: an identifiable sender and a free opt-out.

/** A manager's broadcast to all/some/selected staff. `body` may already
 *  contain the Unicode bold/italic/underline characters the Message Board
 *  toolbar produces — this only adds the business-name prefix and STOP line. */
export function broadcastMessage(
  body: string, urgency: 'urgent' | 'general', business: string, managerName?: string | null
): string {
  const who = managerName ? `${managerName}, ${business}` : business;
  const prefix = urgency === 'urgent' ? `${who} (URGENT): ` : `${who}: `;
  return `${prefix}${body}\nReply STOP to opt out.`;
}

// ── Availability flow (the "gather" cover tier) ─────────────────────────────
// Enough notice to collect options: the manager who started the race picks
// from who's free, rather than it going to whoever replies first. The
// message itself carries no claim code and makes no "first reply wins"
// promise — replying YES here only records that someone is available. This
// same wording is also what the gather tier falls back to once its window
// closes with nobody available (see raceService.ts's advanceGather) — a YES
// from here on wins the shift through the same atomic claim as always, the
// message just never changes to announce that.
//
// Four short lines/paragraphs by design, in this order:
//   1. who's texting and who they're from (sender identification)
//   2. the actual ask
//   3. the opt-out
//   4. what replying does
// STOP is deliberately not the last line — a phone's own quick-reply
// suggestions tend to surface whatever the message's closing sentence asked
// for, so ending on "reply YES or NO" nudges those into the quick-reply
// slot instead of STOP. Line 4 also says "we will confirm" rather than
// implying the shift is theirs the moment they reply — a YES here only
// means they're in the running, same as the rest of this file's comments
// on this tier already say.

/** Wave one: are you free? Not an offer — nobody is given the shift by replying. */
export function availabilityMessage(
  shift: ShiftSummary, staffName: string, business: string, managerName?: string | null
): string {
  const from = managerName ? `it's ${managerName} from ${business}` : `it's ${business}`;
  return [
    `Hey ${staffName}, ${from},`,
    `Are you available to work ${formatShiftDate(shift.date)} ${formatShiftTimes(shift.start_time, shift.end_time)}, in ${shift.departmentName}?`,
    `Reply STOP to opt out.`,
    `Reply YES or NO if you can or can't, and we will confirm the shift shortly after.`,
  ].join('\n');
}

/** Acknowledges a YES during the gather window — it does not win them the shift. */
export function availabilityAckMessage(business: string): string {
  return `${business}: thanks, noted - we'll confirm shortly if you're needed.`;
}

/** The immediate tier's ask — someone hasn't turned up and this shift is
 *  running now. `isTonight` says "tonight" instead of "today" once it's
 *  past 5pm, matching how the store's managers actually phrase this; no
 *  claim code, no "first reply wins" — same urgency as availabilityMessage,
 *  just faster, and ASAP is worked into the reply line rather than added as
 *  a separate sentence to keep the same four-line shape. */
export function urgentAvailabilityMessage(
  shift: ShiftSummary, isTonight: boolean, staffName: string, business: string, managerName?: string | null
): string {
  const from = managerName ? `it's ${managerName} from ${business}` : `it's ${business}`;
  const when = isTonight ? 'tonight' : 'today';
  return [
    `Hey ${staffName}, ${from},`,
    `Are you available to work ${when} at ${formatShiftTimes(shift.start_time, shift.end_time)}, in ${shift.departmentName}?`,
    `Reply STOP to opt out.`,
    `Reply YES or NO ASAP if you can or can't, and we will confirm the shift shortly after.`,
  ].join('\n');
}

// ── Extend-earlier ask ───────────────────────────────────────────────────
// Extending someone's rostered shift LATER is something a manager can just
// ask in person — they're already on shift. Extending it EARLIER means
// asking someone who isn't at the store yet, so that direction goes through
// an SMS confirmation instead of applying instantly (see
// extendService.ts). Not an opt-in race message, so — same as the Message
// Board broadcast — it carries the Spam Act's identification + opt-out on
// its own.

/** Asks someone to come in earlier than their rostered start time.
 *  `departmentName` and `existingStart` describe their shift as it stands
 *  today; `proposedStart` is the earlier time being asked for. */
export function extendAskMessage(
  departmentName: string, existingStart: string, proposedStart: string, business: string, managerName?: string | null
): string {
  const greeting = managerName ? `Hey it's ${managerName} - ` : '';
  return `${greeting}${business}: can you come in earlier today for ${departmentName}, ` +
    `starting ${proposedStart.slice(0, 5)} instead of ${existingStart.slice(0, 5)}? Reply YES or NO. Reply STOP to opt out.`;
}

/** Confirms the earlier start once they reply YES. */
export function extendConfirmedMessage(proposedStart: string, business: string): string {
  return `${business}: thanks, see you at ${proposedStart.slice(0, 5)}.`;
}

/** Sent to whoever the manager picked. Not currently wired into any live
 *  flow — kept for the manager-pick UI this pairs with. */
export function acceptedMessage(business: string): string {
  return `${business}: thank you for accepting the shift, see you soon!`;
}

/** Sent to everyone who offered but wasn't picked. Not currently wired into
 *  any live flow — kept for the manager-pick UI this pairs with. */
export function notSelectedMessage(business: string): string {
  return `${business}: thank you for offering to cover the shift, unfortunately it has been covered.`;
}

// ── Manager messages ────────────────────────────────────────────────────────
// Prefixed differently from staff copy: these arrive on the same number, and
// the manager is often also a staff member receiving the other kind. Never
// carried the store's own business name — "ShiftFlow" identifies the system
// sending it, since the manager already knows which store they run.

const SYSTEM = 'ShiftFlow';

/**
 * One available person, as they reply. The number is what she texts back to
 * give them the shift — names get misspelt, a number doesn't.
 */
export function managerOptionMessage(
  shift: ShiftSummary, name: string, cost: number | null, option: number
): string {
  const price = cost === null ? 'no rate set' : `$${cost.toFixed(2)}`;
  return `${SYSTEM}: ${name} is available for ${describeShift(shift)} - ${price}. ` +
    `Reply ${option} to give it to them.`;
}

/** The full list once the gathering window closes and she hasn't picked. */
export function managerListMessage(
  shift: ShiftSummary,
  options: { option: number; name: string; cost: number | null }[]
): string {
  if (options.length === 0) {
    return `${SYSTEM}: nobody is available for ${describeShift(shift)}. It is still uncovered.`;
  }
  const lines = options
    .map(o => `${o.option}. ${o.name} - ${o.cost === null ? 'no rate' : `$${o.cost.toFixed(2)}`}`)
    .join('\n');
  return `${SYSTEM}: available for ${describeShift(shift)}:\n${lines}\nReply with a number to pick.`;
}

/** Junior wave found nobody — ask whether to widen it to seniors. */
export function managerEscalationMessage(shift: ShiftSummary): string {
  return `${SYSTEM}: no junior staff available for ${describeShift(shift)}, ` +
    `and nobody can extend. Reply YES to ask senior staff, or NO to leave it.`;
}

/** Answers a pick for a shift that has already been filled or closed. */
export function managerStaleSelectionMessage(): string {
  return `${SYSTEM}: that option is no longer open - the shift has already been dealt with.`;
}

/** Answers a manager's reply that isn't one of the numbers on the list they were sent. */
export function managerInvalidPickMessage(): string {
  return `${SYSTEM}: that's not one of the numbers on the list - reply with one from the options sent.`;
}

/** The outcome-only notification for the immediate and sequential tiers — no
 *  decision for the manager to make, just what happened. */
export function managerOutcomeMessage(shift: ShiftSummary, winnerName: string | null): string {
  return winnerName
    ? `${SYSTEM}: ${winnerName} will cover ${describeShift(shift)}.`
    : `${SYSTEM}: nobody was available for ${describeShift(shift)}. It is still uncovered.`;
}

// isGsm7 / smsSegments now live in ./segments (re-exported above) so the
// Message Board's client-side character counter can import them without
// pulling in this file's sms/config.ts dependency (supabaseAdmin).
