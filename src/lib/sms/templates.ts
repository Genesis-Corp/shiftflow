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

/** Sent to every eligible staff member when the race starts. */
export function offerMessage(shift: ShiftSummary, claimCode: string): string {
  return `${BUSINESS}: shift available ${describeShift(shift)}. ` +
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
