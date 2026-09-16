/**
 * Reading the store manager's texts back.
 *
 * She gets a numbered option as each person replies, and picks by texting the
 * number — names get misspelt and two people can share one, a number can't.
 * The same channel also carries her yes/no when the junior wave finds nobody
 * and the system asks whether to widen it to seniors.
 *
 * Pure functions only.
 */

export type ManagerIntent =
  | { kind: 'select'; option: number }
  | { kind: 'approve' }
  | { kind: 'decline' }
  | { kind: 'unknown' };

const APPROVE = ['YES', 'Y', 'YEP', 'YEAH', 'YUP', 'OK', 'OKAY', 'SURE', 'PLEASE', 'GO'];
const DECLINE = ['NO', 'N', 'NOPE', 'NAH', 'LEAVE', 'CANCEL', 'STOP'];

/** Options are one or two digits — see allocateOptionNumber. */
const OPTION_TOKEN = /^\d{1,2}$/;

/**
 * A number anywhere in the reply is a pick, since that is the only thing she
 * is ever asked to send one for — "2", "pick 2" and "#2" all mean the same.
 *
 * Two numbers means it cannot be told which she meant ("call at 3 or 4"), so
 * it comes back unknown and she gets asked again rather than having the
 * system guess and hand the shift to the wrong person.
 */
export function parseManagerReply(body: string): ManagerIntent {
  const text = (body ?? '').trim().toUpperCase();
  if (!text) return { kind: 'unknown' };

  const tokens = text.split(/[^A-Z0-9]+/).filter(Boolean);
  const numbers = tokens.filter(t => OPTION_TOKEN.test(t)).map(Number).filter(n => n >= 1);

  if (numbers.length === 1) return { kind: 'select', option: numbers[0] };
  if (numbers.length > 1) return { kind: 'unknown' };

  if (tokens.some(t => APPROVE.includes(t))) return { kind: 'approve' };
  if (tokens.some(t => DECLINE.includes(t))) return { kind: 'decline' };

  return { kind: 'unknown' };
}

/** Largest option number that can be handed out before numbering wraps. */
export const MAX_OPTION_NUMBER = 99;

/**
 * The next option number to give out, given those already in play across
 * every cover request still open for this manager.
 *
 * Counting up rather than filling gaps is deliberate: a number she has
 * already been texted should not come to mean somebody else while she might
 * still reply to it. Numbers only return to 1 once nothing is open, and wrap
 * to the lowest free number in the unlikely event of running past 99.
 */
export function allocateOptionNumber(taken: number[]): number {
  if (taken.length === 0) return 1;

  const next = Math.max(...taken) + 1;
  if (next <= MAX_OPTION_NUMBER) return next;

  const used = new Set(taken);
  for (let n = 1; n <= MAX_OPTION_NUMBER; n++) if (!used.has(n)) return n;
  throw new Error('No option numbers left — too many cover requests are open at once.');
}
