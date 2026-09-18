/**
 * How a cover request is run, decided by how long there is until the shift.
 *
 * Three tiers, from the store's own process:
 *
 *  immediate   Someone hasn't turned up. The top two get asked to come in
 *              ASAP; if both decline (or neither answers inside five
 *              minutes) the next two are asked, and so on. First yes takes
 *              it — there is no time to have anyone choose.
 *
 *  gather      Enough notice to collect options. Everyone eligible is asked
 *              at once, replies are gathered for a window sized by how far
 *              off the shift is, and the manager picks. If the window closes
 *              with nobody having said yes, it degrades to first yes wins so
 *              the shift still gets filled.
 *
 *  sequential  Two or more days out. One person at a time, four hours each,
 *              working down the ranked list — no point blasting everyone for
 *              a shift that isn't for days.
 *
 * Pure functions only. Every time value is passed in rather than read from
 * the clock, so the awkward cases (a window that would run past the shift,
 * a step that would land at 3am) are directly testable.
 */

import { daysBetween, timeToMinutes } from './shiftUtils';

export type CoverTier = 'immediate' | 'gather' | 'sequential';

/** How many people the immediate tier asks at a time. */
export const IMMEDIATE_BATCH_SIZE = 2;
/** Silence for this long and the immediate tier moves to the next pair. */
export const IMMEDIATE_BATCH_TIMEOUT_MINUTES = 5;
/** How long each person gets in the sequential tier. */
export const SEQUENTIAL_STEP_MINUTES = 4 * 60;
/** At or beyond this much notice, go one at a time instead of gathering. */
export const SEQUENTIAL_LEAD_MINUTES = 48 * 60;
/** Below this much notice there isn't time to gather anything. */
export const MIN_GATHER_LEAD_MINUTES = 30;
/** Never let a gather window run right up to the shift — they have to get there. */
export const ARRIVAL_BUFFER_MINUTES = 10;

/** Minutes from `nowDate`/`nowTime` (both local, same timezone as the shift)
 *  until the shift starts. Negative once the shift has started. */
export function leadMinutesFor(
  shiftDate: string, shiftStartTime: string, nowDate: string, nowTime: string
): number {
  return daysBetween(nowDate, shiftDate) * 24 * 60
    + (timeToMinutes(shiftStartTime.slice(0, 5)) - timeToMinutes(nowTime.slice(0, 5)));
}

/**
 * `leadMinutes` is how long until the shift starts; zero or negative means it
 * has already started, which is the no-show case the immediate tier exists for.
 */
export function tierFor(leadMinutes: number): CoverTier {
  if (leadMinutes < MIN_GATHER_LEAD_MINUTES) return 'immediate';
  if (leadMinutes < SEQUENTIAL_LEAD_MINUTES) return 'gather';
  return 'sequential';
}

/**
 * How long to collect replies before showing the manager the full list.
 * More notice buys a longer window, up to two hours — but never so long that
 * it runs into the shift itself.
 */
export function gatherWindowMinutes(leadMinutes: number): number {
  const base =
    leadMinutes < 60 ? 30 :
    leadMinutes < 120 ? 60 :
    leadMinutes < 180 ? 90 : 120;

  const latest = leadMinutes - ARRIVAL_BUFFER_MINUTES;
  return Math.max(5, Math.min(base, latest));
}

/**
 * Cheapest first, reliability breaking ties — the store manager's call, so
 * she can take the cheapest option without it silently being the least
 * reliable one.
 *
 * Anyone without a rate set sorts last: with no figure they cannot be shown
 * to be the cheapest, and guessing at zero would put them top of every list.
 */
export function rankCandidates<T extends { shift_cost: number | null; reliability_score: number }>(
  candidates: T[]
): T[] {
  return [...candidates].sort((a, b) => {
    if (a.shift_cost !== null && b.shift_cost !== null) {
      if (a.shift_cost !== b.shift_cost) return a.shift_cost - b.shift_cost;
      return b.reliability_score - a.reliability_score;
    }
    if (a.shift_cost !== null) return -1;
    if (b.shift_cost !== null) return 1;
    return b.reliability_score - a.reliability_score;
  });
}

/** Split a ranked list into the batches the immediate tier works through. */
export function batchesOf<T>(items: T[], size: number = IMMEDIATE_BATCH_SIZE): T[][] {
  if (size < 1) throw new Error('Batch size must be at least 1');
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

/**
 * What raceService.ts's lazy advance step decides for a running race, kept
 * as pure functions over a state snapshot so the escalation rules (when a
 * tier moves on, when it gives up) are directly testable — the same reason
 * expireIfDue's own timing logic lives in tests, not just production traffic.
 */
export interface TierRecipient {
  staffId: string;
  outcome: 'won' | 'lost' | 'declined' | 'no_response' | null;
  isAvailable?: boolean | null;
}

export type ImmediateAction =
  | { type: 'wait' }
  | { type: 'advance'; batchIndex: number; recipients: TierRecipient[] }
  | { type: 'exhausted' };

/**
 * `recipients` is every contactable candidate for the race, in rank order
 * (cheapest first) — the same order they were inserted in. A batch is done
 * once its deadline passes, or once everyone in it has explicitly declined;
 * either way the next batch (if any) is asked next.
 */
export function nextImmediateAction(
  recipients: TierRecipient[], currentBatch: number, batchDeadline: Date, now: Date
): ImmediateAction {
  const batches = batchesOf(recipients);
  const active = batches[currentBatch] ?? [];
  const batchDone = now.getTime() >= batchDeadline.getTime()
    || (active.length > 0 && active.every(r => r.outcome === 'declined'));
  if (!batchDone) return { type: 'wait' };

  const nextBatch = batches[currentBatch + 1];
  if (!nextBatch || nextBatch.length === 0) return { type: 'exhausted' };
  return { type: 'advance', batchIndex: currentBatch + 1, recipients: nextBatch };
}

export type GatherAction =
  | { type: 'wait' }
  | { type: 'notify_manager'; available: TierRecipient[] }
  | { type: 'degrade'; recipients: TierRecipient[] };

/**
 * `recipients` is every contactable candidate, ranked. While the window is
 * open, nothing happens here — replies are just recorded as they arrive.
 * Once it closes: anyone who said they're available goes to the manager to
 * pick from (cheapest first); if nobody did, it degrades to first-yes-wins
 * for everyone who hasn't explicitly said no, so the shift still gets a shot
 * at being filled.
 */
export function nextGatherAction(recipients: TierRecipient[], gatherDeadline: Date, now: Date): GatherAction {
  if (now.getTime() < gatherDeadline.getTime()) return { type: 'wait' };

  const available = recipients.filter(r => r.isAvailable === true && r.outcome === null);
  if (available.length > 0) return { type: 'notify_manager', available };

  const remaining = recipients.filter(r => r.outcome === null && r.isAvailable !== false);
  return { type: 'degrade', recipients: remaining };
}

export type SequentialAction =
  | { type: 'wait' }
  | { type: 'advance'; index: number; recipient: TierRecipient }
  | { type: 'exhausted' };

/**
 * `recipients` is every contactable candidate, ranked — one is "live" at a
 * time. Their step ends on an explicit decline or the step deadline; either
 * way the next person in line (if any) is asked next.
 */
export function nextSequentialAction(
  recipients: TierRecipient[], currentIndex: number, stepDeadline: Date, now: Date
): SequentialAction {
  const current = recipients[currentIndex];
  if (!current) return { type: 'exhausted' };

  const stepDone = now.getTime() >= stepDeadline.getTime() || current.outcome === 'declined';
  if (!stepDone) return { type: 'wait' };

  const next = recipients[currentIndex + 1];
  if (!next) return { type: 'exhausted' };
  return { type: 'advance', index: currentIndex + 1, recipient: next };
}

/**
 * Minutes to wait before it's acceptable to text someone, given the local
 * time now and the quiet-hours window. Zero means send now.
 *
 * The immediate tier deliberately does not consult this — someone has not
 * turned up for a shift that is running, and a 6am no-show is exactly when
 * the phone should ring.
 */
export function deferMinutesForQuietHours(
  localTime: string,
  quiet: { start: string; end: string } | null
): number {
  if (!quiet) return 0;

  const mins = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const now = mins(localTime);
  const start = mins(quiet.start);
  const end = mins(quiet.end);

  const inQuiet = start <= end
    ? now >= start && now < end
    : now >= start || now < end;
  if (!inQuiet) return 0;

  // Wrap forward to the end of the window, crossing midnight if it does.
  return end > now ? end - now : 24 * 60 - now + end;
}
