/**
 * Pure claim-race logic. No database, no network — everything here is
 * directly unit-testable, which matters because the interesting cases
 * (two YES replies in the same second, a reply arriving an hour late) are
 * impractical to produce by hand.
 */

/**
 * Claim code alphabet. 0/O and 1/I/L are omitted: a staff member reads this
 * off a phone screen and types it back, and those pairs are where that goes
 * wrong. 31^4 = ~923k combinations, and codes only need to be unique among
 * races currently in play.
 */
export const CLAIM_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CLAIM_CODE_LENGTH = 4;

export function generateClaimCode(
  random: () => number = Math.random
): string {
  let code = '';
  for (let i = 0; i < CLAIM_CODE_LENGTH; i++) {
    code += CLAIM_CODE_ALPHABET[Math.floor(random() * CLAIM_CODE_ALPHABET.length)];
  }
  return code;
}

/** Generate `count` distinct codes, avoiding any already in use. */
export function generateDistinctCodes(
  count: number,
  taken: Iterable<string> = [],
  random: () => number = Math.random
): string[] {
  const used = new Set([...taken].map(c => c.toUpperCase()));
  const out: string[] = [];
  let guard = 0;
  while (out.length < count) {
    if (guard++ > count * 200) {
      throw new Error('Unable to generate distinct claim codes — too many races in play');
    }
    const code = generateClaimCode(random);
    if (used.has(code)) continue;
    used.add(code);
    out.push(code);
  }
  return out;
}

export type ReplyIntent = 'yes' | 'no' | 'stop' | 'unknown';

export interface ParsedReply {
  intent: ReplyIntent;
  code: string | null;
}

const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'OPTOUT', 'OPT OUT', 'QUIT'];
const YES_WORDS = ['YES', 'Y', 'YEP', 'YEAH', 'YUP', 'YE', 'OK', 'OKAY', 'SURE', 'CLAIM', 'ACCEPT'];
const NO_WORDS  = ['NO', 'N', 'NOPE', 'NAH', 'CANT', 'CANNOT', 'BUSY', 'UNABLE', 'DECLINE', 'SORRY'];

const CODE_TOKEN = new RegExp(`\\b[${CLAIM_CODE_ALPHABET}]{${CLAIM_CODE_LENGTH}}\\b`, 'g');

/**
 * Interpret an inbound SMS body.
 *
 * The returned code is a *candidate* — it still has to match a live recipient
 * row. Plenty of ordinary words ("BUSY", "YEAH") are also valid code strings,
 * so the database lookup is what decides, and a miss falls back to matching on
 * the sender's phone number.
 */
export function parseInboundMessage(raw: string): ParsedReply {
  const text = (raw ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!text) return { intent: 'unknown', code: null };

  // Opt-out wins over everything. "stop texting me, no thanks" must never be
  // read as a decline that leaves them subscribed.
  const words = text.split(/[^A-Z0-9]+/).filter(Boolean);
  if (STOP_WORDS.some(w => (w.includes(' ') ? text.includes(w) : words.includes(w)))) {
    return { intent: 'stop', code: null };
  }

  const codes = text.match(CODE_TOKEN) ?? [];
  // Prefer a code that isn't also an intent word, so "YES 4F7K" picks 4F7K.
  const code =
    codes.find(c => !YES_WORDS.includes(c) && !NO_WORDS.includes(c)) ?? codes[0] ?? null;

  if (NO_WORDS.some(w => words.includes(w))) return { intent: 'no', code };
  if (YES_WORDS.some(w => words.includes(w))) return { intent: 'yes', code };

  // A bare code on its own is a claim — it's what someone sends when they
  // copy the code out of the message without retyping "YES".
  if (code && words.length === 1) return { intent: 'yes', code };

  return { intent: 'unknown', code };
}

export type RaceStatus = 'active' | 'claimed' | 'expired' | 'cancelled';

/** A race is only claimable while active and unexpired. */
export function isRaceOpen(
  race: { status: RaceStatus; winner_staff_id: string | null; expires_at: string },
  now: Date = new Date()
): boolean {
  return race.status === 'active'
    && race.winner_staff_id === null
    && new Date(race.expires_at).getTime() > now.getTime();
}

export interface EligibilityIssue {
  staffId: string;
  name: string;
  reason: 'no_phone' | 'opted_out';
}

export interface ContactSplit<T> {
  contactable: T[];
  excluded: EligibilityIssue[];
}

/**
 * Split scored candidates into those we can actually text and those we can't,
 * so the confirmation dialog can show the manager exactly who will be reached
 * — and, just as importantly, who won't be.
 */
export function splitContactable<
  T extends { id: string; name: string; phone_e164?: string | null; sms_opt_out?: boolean }
>(candidates: T[]): ContactSplit<T> {
  const contactable: T[] = [];
  const excluded: EligibilityIssue[] = [];

  for (const c of candidates) {
    if (c.sms_opt_out) {
      excluded.push({ staffId: c.id, name: c.name, reason: 'opted_out' });
    } else if (!c.phone_e164) {
      excluded.push({ staffId: c.id, name: c.name, reason: 'no_phone' });
    } else {
      contactable.push(c);
    }
  }
  return { contactable, excluded };
}
