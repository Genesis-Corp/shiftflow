/**
 * Shared shift calculation utilities.
 * Break rule: any shift >= 5.5 hours requires a 30-minute break.
 */

export const BREAK_THRESHOLD_MINUTES = 330; // 5h 30m
export const BREAK_DURATION_MINUTES = 30;
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A single shift can be extended to cover an overlapping open one only up to this length. */
export const MAX_EXTENDED_SHIFT_MINUTES = 10 * 60;
/** Ordinary weekly hours cap (Sunday–Saturday) — going over excludes someone from a claim race. */
export const WEEKLY_HOURS_CAP_MINUTES = 38 * 60;

/** Convert "HH:MM" to total minutes since midnight */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Convert total minutes since midnight to "HH:MM" */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Duration in minutes between two "HH:MM" strings */
export function shiftDurationMinutes(start: string, end: string): number {
  const startM = timeToMinutes(start);
  let endM = timeToMinutes(end);
  if (endM <= startM) endM += 24 * 60; // overnight shift
  return endM - startM;
}

/** Whether a shift needs a break */
export function requiresBreak(start: string, end: string): boolean {
  return shiftDurationMinutes(start, end) >= BREAK_THRESHOLD_MINUTES;
}

/** Human-readable shift duration */
export function formatDuration(start: string, end: string): string {
  const mins = shiftDurationMinutes(start, end);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Check if a staff availability window covers a requested shift */
export function availabilityCoversShift(
  availStart: string,
  availEnd: string,
  shiftStart: string,
  shiftEnd: string
): boolean {
  return timeToMinutes(availStart) <= timeToMinutes(shiftStart) &&
    timeToMinutes(availEnd) >= timeToMinutes(shiftEnd);
}

/** Get day-of-week index (0=Sun) from a YYYY-MM-DD date string */
export function dayOfWeekFromDate(dateStr: string): number {
  return new Date(dateStr + 'T00:00:00').getDay();
}

/** Add (or subtract) whole days to a YYYY-MM-DD date string, correctly
 *  crossing month and year boundaries (used by the Shifts timeline's
 *  previous/next day arrows).
 *
 *  Stays in local time from construction through to the formatted result.
 *  Reading it back out via toISOString() (always UTC) silently shifts the
 *  date by a day for anyone in a positive UTC offset — e.g. Australia —
 *  which is what broke "next" (rounded back to the same day) and
 *  "previous" (landed two days back) on the Shifts timeline. */
export function addDays(dateStr: string, delta: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The Sunday–Saturday week (inclusive) a date falls in. */
export function weekBounds(dateStr: string): { weekStart: string; weekEnd: string } {
  const dow = dayOfWeekFromDate(dateStr);
  return { weekStart: addDays(dateStr, -dow), weekEnd: addDays(dateStr, 6 - dow) };
}

/** Whether `birthday` (a YYYY-MM-DD date, year irrelevant) falls on `dateStr`
 *  — month and day only, so it recurs every year. */
export function isBirthday(birthday: string | null | undefined, dateStr: string): boolean {
  if (!birthday) return false;
  return birthday.slice(5, 10) === dateStr.slice(5, 10);
}

/**
 * Whether two same-day time ranges overlap. Touching endpoints (one ends
 * exactly when the other starts) do not count — that's a legitimate back-
 * to-back pair, not a conflict.
 */
export function shiftsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const aStartM = timeToMinutes(aStart);
  let aEndM = timeToMinutes(aEnd);
  if (aEndM <= aStartM) aEndM += 24 * 60;

  const bStartM = timeToMinutes(bStart);
  let bEndM = timeToMinutes(bEnd);
  if (bEndM <= bStartM) bEndM += 24 * 60;

  return aStartM < bEndM && bStartM < aEndM;
}

/** The smallest single range spanning two overlapping (or touching) shifts. */
export function mergeShiftRanges(
  aStart: string, aEnd: string, bStart: string, bEnd: string
): { start_time: string; end_time: string } {
  const startM = Math.min(timeToMinutes(aStart), timeToMinutes(bStart));
  const aEndM = timeToMinutes(aEnd) <= timeToMinutes(aStart) ? timeToMinutes(aEnd) + 24 * 60 : timeToMinutes(aEnd);
  const bEndM = timeToMinutes(bEnd) <= timeToMinutes(bStart) ? timeToMinutes(bEnd) + 24 * 60 : timeToMinutes(bEnd);
  const endM = Math.max(aEndM, bEndM);
  return { start_time: minutesToTime(startM), end_time: minutesToTime(endM) };
}

/**
 * Adjust a shift's start/end time.
 * Returns new start, end, and whether a break is now required.
 */
export function adjustShift(
  currentStart: string,
  currentEnd: string,
  newStart?: string,
  newEnd?: string
): { start: string; end: string; hasBreak: boolean; breakMinutes: number } {
  const start = newStart ?? currentStart;
  const end = newEnd ?? currentEnd;
  const hasBreak = requiresBreak(start, end);
  return {
    start,
    end,
    hasBreak,
    breakMinutes: hasBreak ? BREAK_DURATION_MINUTES : 0,
  };
}

/** Format a date string as "Mon 27 Apr" */
export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Reliability score delta for each incident type */
export const RELIABILITY_DELTAS: Record<string, number> = {
  no_show: -15,
  no_answer: -5,
  rejected: -3,
  covered: +10,
};

export function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

// ── Daily availability timeline ─────────────────────────────────────────────
// The Availability page's daily view draws one horizontal bar per staff
// member across a fixed 5am-10pm window. These helpers turn a start/end time
// into that bar's position, and hour-of-day into its column label.

export const TIMELINE_START_HOUR = 5;  // 5am
export const TIMELINE_END_HOUR = 22;   // 10pm

/**
 * Left offset and width, as percentages of the 5am-10pm span, for a bar
 * representing `start`-`end`. Clips to the visible window rather than
 * overflowing it, so someone available from 4am still shows a bar starting
 * at the 5am edge instead of running off the chart.
 *
 * Returns null when the range has no overlap with the visible window at all
 * (e.g. an overnight range that starts exactly at the right-hand edge).
 */
export function timelineBarPosition(
  start: string, end: string
): { leftPct: number; widthPct: number } | null {
  const spanStart = TIMELINE_START_HOUR * 60;
  const spanEnd = TIMELINE_END_HOUR * 60;
  const spanMinutes = spanEnd - spanStart;

  const startM = timeToMinutes(start);
  let endM = timeToMinutes(end);
  if (endM <= startM) endM += 24 * 60; // treat as running past midnight

  const clippedStart = Math.max(startM, spanStart);
  const clippedEnd = Math.min(endM, spanEnd);
  if (clippedEnd <= clippedStart) return null;

  return {
    leftPct: ((clippedStart - spanStart) / spanMinutes) * 100,
    widthPct: ((clippedEnd - clippedStart) / spanMinutes) * 100,
  };
}

/** Hour-of-day (0-23) as a short 12-hour label: 5 -> "5am", 13 -> "1pm". */
export function formatHour12(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}
