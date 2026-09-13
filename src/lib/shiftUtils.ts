/**
 * Shared shift calculation utilities.
 * Break rule: any shift >= 5.5 hours requires a 30-minute break.
 */

export const BREAK_THRESHOLD_MINUTES = 330; // 5h 30m
export const BREAK_DURATION_MINUTES = 30;
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

/** Format "17:35:00" as "5:35pm", and "06:00:00" as "6am" — how the sheet reads. */
export function formatTime12(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, '0')}${suffix}` : `${hour}${suffix}`;
}

/** Format a pair of times as "6am–2pm". */
export function formatTimeRange12(start: string, end: string): string {
  return `${formatTime12(start)}\u2013${formatTime12(end)}`;
}

/** Format a date string as "Mon 27 Apr" */
export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Reliability score delta for each incident type.
 *
 * Turning down a shift is barely a mark against anyone — people are entitled to
 * their own plans on a day they were never rostered. Not turning up to a shift
 * they had accepted is the serious one.
 */
export const RELIABILITY_DELTAS: Record<string, number> = {
  no_show: -15,
  no_answer: -5,
  rejected: -1,
  covered: +10,
};

/** The same numbers written for display, e.g. "−15" and "+10". */
export function formatDelta(type: string): string {
  const delta = RELIABILITY_DELTAS[type] ?? 0;
  return delta < 0 ? `\u2212${Math.abs(delta)}` : `+${delta}`;
}

export function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}
