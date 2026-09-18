import { getTimezone } from './config';

/**
 * Message copy.
 *
 * Every message must stay within 160 GSM-7 characters. At 161 the carrier
 * splits it into two segments and the cost doubles, silently. `smsSegments()`
 * below is used by the tests to hold that line.
 *
 * The Spam Act 2003 expects the sender to be identifiable and to offer a free
 * opt-out, so the business name leads and STOP is offered on the offer message
 * (the only one a recipient can receive without having opted in to this race).
 */

export interface ShiftSummary {
  date: string;        // YYYY-MM-DD
  start_time: string;  // HH:MM[:SS]
  end_time: string;    // HH:MM[:SS]
  departmentName: string;
}

const BUSINESS = process.env.SMS_BUSINESS_NAME?.trim() || "Farmer Jack's";

/** "Mon 15 Sep" in the configured timezone. */
export function formatShiftDate(date: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: getTimezone(), weekday: 'short', day: 'numeric', month: 'short',
  }).format(new Date(`${date}T00:00:00`));
}

/** "09:00-17:00" — trims the seconds Postgres returns on a `time` column. */
export function formatShiftTimes(start: string, end: string): string {
  return `${start.slice(0, 5)}-${end.slice(0, 5)}`;
}

export function describeShift(shift: ShiftSummary): string {
  return `${formatShiftDate(shift.date)} ${formatShiftTimes(shift.start_time, shift.end_time)}, ${shift.departmentName}`;
}

/** Sent to every eligible staff member when the race starts. `managerName`,
 *  when known, opens the message with who started it. */
export function offerMessage(shift: ShiftSummary, claimCode: string, managerName?: string | null): string {
  const greeting = managerName ? `Hey it's ${managerName} - ` : '';
  return `${greeting}${BUSINESS}: shift available ${describeShift(shift)}. ` +
    `Reply YES ${claimCode} to claim it - first reply wins. Reply STOP to opt out.`;
}

/** Sent to the winner, confirming the shift is theirs. */
export function winnerMessage(shift: ShiftSummary, name: string): string {
  return `${BUSINESS}: thanks ${name}, the ${describeShift(shift)} shift is yours. See you then.`;
}

/** Broadcast to everyone else the moment the race is won. */
export function coveredMessage(shift: ShiftSummary): string {
  return `${BUSINESS}: the ${describeShift(shift)} shift has now been covered. Thanks!`;
}

/**
 * Sent when a YES arrives after the race is already won — the staff member
 * whose phone was off, or who replied a second too late. Without this they
 * get silence after an explicit action, and may turn up to the shift.
 */
export function tooLateMessage(shift: ShiftSummary): string {
  return `${BUSINESS}: sorry, the ${describeShift(shift)} shift has already been covered by someone else.`;
}

/** Acknowledges an explicit NO, so the reply isn't met with silence. */
export function declinedMessage(): string {
  return `${BUSINESS}: no worries, thanks for letting us know.`;
}

/** Confirms an opt-out. */
export function optOutMessage(): string {
  return `${BUSINESS}: you will not receive any more shift messages from us.`;
}

// ── Availability flow (the "gather" cover tier) ─────────────────────────────
// Enough notice to collect options: the manager who started the race picks
// from who's free, rather than it going to whoever replies first. The
// message itself carries no claim code and makes no "first reply wins"
// promise — replying YES here only records that someone is available.

/** Wave one: are you free? Not an offer — nobody is given the shift by replying. */
export function availabilityMessage(shift: ShiftSummary, managerName?: string | null): string {
  const greeting = managerName ? `Hey it's ${managerName} - ` : '';
  return `${greeting}${BUSINESS}: are you available for ${describeShift(shift)}? Reply YES or NO.`;
}

/** Acknowledges a YES during the gather window — it does not win them the shift. */
export function availabilityAckMessage(): string {
  return `${BUSINESS}: thanks, noted - we'll confirm shortly if you're needed.`;
}

/** The immediate tier's ask — someone hasn't turned up and this shift is
 *  running now. `isTonight` says "tonight" instead of "today" once it's
 *  past 5pm, matching how the store's managers actually phrase this; no
 *  claim code, no "first reply wins" — same urgency as availabilityMessage,
 *  just faster. */
export function urgentAvailabilityMessage(shift: ShiftSummary, isTonight: boolean, managerName?: string | null): string {
  const greeting = managerName ? `Hey it's ${managerName} - ` : '';
  const when = isTonight ? 'tonight' : 'today';
  return `${greeting}${BUSINESS}: are you available to work ${when} at ${formatShiftTimes(shift.start_time, shift.end_time)}, ` +
    `${shift.departmentName}? Let me know YES or NO ASAP.`;
}

/** Sent to whoever the manager picked. */
export function acceptedMessage(): string {
  return `${BUSINESS}: thank you for accepting the shift, see you soon!`;
}

/** Sent to everyone who offered but wasn't picked. */
export function notSelectedMessage(): string {
  return `${BUSINESS}: thank you for offering to cover the shift, unfortunately it has been covered.`;
}

// ── Manager messages ────────────────────────────────────────────────────────
// Prefixed differently from staff copy: these arrive on the same number, and
// the manager is often also a staff member receiving the other kind.

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

/** Characters that are NOT in the GSM-7 alphabet force a 70-char UCS-2 segment. */
const GSM7 =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENDED = '^{}\\[~]|€';

export function isGsm7(text: string): boolean {
  return [...text].every(c => GSM7.includes(c) || GSM7_EXTENDED.includes(c));
}

/** How many SMS segments this body will cost. */
export function smsSegments(text: string): number {
  if (!isGsm7(text)) {
    return text.length <= 70 ? 1 : Math.ceil(text.length / 67);
  }
  // Extended characters occupy two septets each.
  const septets = [...text].reduce(
    (n, c) => n + (GSM7_EXTENDED.includes(c) ? 2 : 1), 0
  );
  return septets <= 160 ? 1 : Math.ceil(septets / 153);
}
