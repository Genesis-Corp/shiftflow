import { timeToMinutes, minutesToTime, dayOfWeekFromDate, shiftDurationMinutes } from './shiftUtils';

/**
 * What a shift costs to fill, per person — computed from the award, not
 * typed in by hand.
 *
 * Farmer Jack's 2026 Wage Table is, cell for cell, one number (the adult
 * ordinary Mon-Fri rate) multiplied by an age-based percentage and a
 * time-of-week/employment-type percentage. Every rate in this file is
 * derived that way: rate = adult_base_rate x age% x time%.
 *
 * Pure functions only — no database. The Cover Shift flow shows these
 * figures to a manager who then picks someone partly on price, so every
 * number here is acted on: it is worth the unit tests.
 *
 * Two time-of-week rules that both cover the same minute do not stack —
 * the higher percentage wins, same as the age-based rules never stack with
 * each other (there's only ever one age bracket at a time).
 */

export type EmploymentCategory = 'ft_pt' | 'casual';

export interface AgeBracket {
  id: string;
  label: string;
  /** null = no lower bound. */
  min_age: number | null;
  /** null = no upper bound. Exclusive when set — 16 means "up to but not including 16". */
  max_age: number | null;
  /** null = no service requirement. Only the 20-21 bracket uses this. */
  min_service_months: number | null;
  percentage: number;
}

export interface TimeLoading {
  id: string;
  label: string;
  employment_category: EmploymentCategory;
  /** 0 = Sunday .. 6 = Saturday. Ignored when is_public_holiday or is_overtime. */
  days: number[];
  start_time: string;
  /** May be "24:00" for a rule running to midnight. */
  end_time: string;
  percentage: number;
  /** Applies whenever the shift's date is a public holiday, regardless of day/time. */
  is_public_holiday: boolean;
  /** Applies to the portion of a single shift past the overtime threshold. */
  is_overtime: boolean;
}

/** A single shift, past the overtime threshold, is paid overtime for the excess. */
export const OVERTIME_THRESHOLD_MINUTES = 9 * 60;

/** Whole years old on `asOfDate`, from a YYYY-MM-DD birthday — pure integer
 *  date-part math, no Date object round-trip (see addDays' history for why
 *  that matters: it silently shifts by a day outside UTC). */
export function ageInYears(birthday: string, asOfDate: string): number {
  const [by, bm, bd] = birthday.split('-').map(Number);
  const [ay, am, ad] = asOfDate.split('-').map(Number);
  let age = ay - by;
  if (am < bm || (am === bm && ad < bd)) age--;
  return age;
}

/** Whole months of service on `asOfDate`, from a YYYY-MM-DD commencement date. */
export function monthsOfService(commencementDate: string, asOfDate: string): number {
  const [sy, sm, sd] = commencementDate.split('-').map(Number);
  const [ay, am, ad] = asOfDate.split('-').map(Number);
  let months = (ay - sy) * 12 + (am - sm);
  if (ad < sd) months--;
  return Math.max(0, months);
}

/**
 * Which age bracket someone falls into, as of a given date.
 *
 * Only the 20-21 bracket is split by service length. An unknown
 * commencement date (never recorded) is treated as satisfying any service
 * requirement — the safer of the two ways to be wrong is overpaying a
 * 20-year-old for a few months, not underpaying one whose start date just
 * wasn't entered yet.
 */
export function ageBracketFor(
  birthday: string | null | undefined,
  asOfDate: string,
  commencementDate: string | null | undefined,
  brackets: AgeBracket[]
): AgeBracket | null {
  if (!birthday) return null;
  const age = ageInYears(birthday, asOfDate);
  const serviceMonths = commencementDate ? monthsOfService(commencementDate, asOfDate) : null;

  const ageMatches = brackets.filter(b =>
    (b.min_age === null || age >= b.min_age) && (b.max_age === null || age < b.max_age)
  );
  if (!ageMatches.length) return null;

  const eligible = ageMatches.filter(b =>
    !b.min_service_months || serviceMonths === null || serviceMonths >= b.min_service_months
  );
  const pool = eligible.length ? eligible : ageMatches;
  return pool.reduce((best, b) => (b.min_service_months ?? 0) > (best.min_service_months ?? 0) ? b : best);
}

export interface ShiftCostInput {
  date: string;
  start_time: string;
  end_time: string;
  /** Meal breaks are unpaid, so they come off the paid total. */
  unpaid_break_minutes?: number;
  employment_category: EmploymentCategory;
  /** The age bracket's percentage, e.g. 90 for 90%. */
  age_percentage: number;
}

export interface CostSegment {
  start: string;
  end: string;
  minutes: number;
  /** 1.5 for a 150% loading, etc. */
  multiplier: number;
  rule: string | null;
}

export interface ShiftCost {
  rostered_minutes: number;
  paid_minutes: number;
  cost: number;
  /** Weighted average time-of-week loading across the shift — 1.0 is all ordinary time. */
  effective_multiplier: number;
  segments: CostSegment[];
}

function toMinutes(time: string): number {
  return timeToMinutes(time.slice(0, 5));
}

/**
 * What a shift costs, for one person, given their age-bracket percentage
 * and employment category. adultBaseRate x age% x time-of-week% for every
 * minute worked, split at every rule boundary the shift crosses so (for
 * example) a 15:00-21:00 weekday shift is ordinary time to 18:00 and
 * evening rate after it.
 */
export function calculateShiftCost(
  input: ShiftCostInput,
  adultBaseRate: number,
  timeLoadings: TimeLoading[],
  isPublicHoliday: boolean
): ShiftCost {
  const { date, start_time, end_time, employment_category, age_percentage } = input;
  const unpaidBreak = input.unpaid_break_minutes ?? 0;

  const relevant = timeLoadings.filter(l => l.employment_category === employment_category);
  const dayTimeRules = relevant.filter(l => !l.is_public_holiday && !l.is_overtime);
  const phRule = relevant.find(l => l.is_public_holiday) ?? null;
  const otRule = relevant.find(l => l.is_overtime) ?? null;
  // The lowest of this category's own day/time percentages is its ordinary
  // rate — the floor for any minute no rule explicitly covers (e.g. a
  // trading hour past 11pm this table doesn't list).
  const floorPct = dayTimeRules.length ? Math.min(...dayTimeRules.map(r => r.percentage)) : 100;

  const shiftDow = dayOfWeekFromDate(date);
  const startM = toMinutes(start_time);
  const rosteredMinutes = shiftDurationMinutes(start_time.slice(0, 5), end_time.slice(0, 5));
  const endM = startM + rosteredMinutes;
  const otStart = startM + OVERTIME_THRESHOLD_MINUTES;

  const boundaries = new Set<number>([startM, endM]);
  for (let dayOffset = 0; dayOffset <= Math.floor(endM / (24 * 60)); dayOffset++) {
    const base = dayOffset * 24 * 60;
    for (const rule of dayTimeRules) {
      for (const edge of [base + toMinutes(rule.start_time), base + toMinutes(rule.end_time)]) {
        if (edge > startM && edge < endM) boundaries.add(edge);
      }
    }
  }
  if (otRule && otStart > startM && otStart < endM) boundaries.add(otStart);

  const points = [...boundaries].sort((a, b) => a - b);
  const segments: CostSegment[] = [];
  let weightedMinutes = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const minutes = to - from;
    if (minutes <= 0) continue;

    // Sample the middle of the segment: by construction nothing changes inside it.
    const mid = from + minutes / 2;
    let bestPct = floorPct;
    let bestLabel: string | null = null;

    if (isPublicHoliday && phRule) {
      bestPct = phRule.percentage;
      bestLabel = phRule.label;
    } else {
      const dayOffset = Math.floor(mid / (24 * 60));
      const dow = (shiftDow + dayOffset) % 7;
      const withinDay = mid - dayOffset * 24 * 60;
      for (const rule of dayTimeRules) {
        if (!rule.days.includes(dow)) continue;
        if (withinDay < toMinutes(rule.start_time) || withinDay >= toMinutes(rule.end_time)) continue;
        if (rule.percentage > bestPct) {
          bestPct = rule.percentage;
          bestLabel = rule.label;
        }
      }
    }

    if (otRule && mid >= otStart && otRule.percentage > bestPct) {
      bestPct = otRule.percentage;
      bestLabel = otRule.label;
    }

    // A boundary that turned out not to change anything (e.g. the overtime
    // threshold lands inside an already-higher-rated public holiday) merges
    // into the segment before it rather than showing as a pointless split.
    const prev = segments[segments.length - 1];
    if (prev && prev.multiplier === bestPct / 100) {
      prev.end = minutesToTime(to);
      prev.minutes += minutes;
    } else {
      segments.push({
        start: minutesToTime(from),
        end: minutesToTime(to),
        minutes,
        multiplier: bestPct / 100,
        rule: bestLabel,
      });
    }
    weightedMinutes += minutes * (bestPct / 100);
  }

  const paidMinutes = Math.max(0, rosteredMinutes - unpaidBreak);
  // The break comes off proportionally rather than out of one segment —
  // picking a segment to deduct it from would be arbitrary and would quietly
  // favour whichever rate we chose.
  const paidRatio = rosteredMinutes > 0 ? paidMinutes / rosteredMinutes : 0;
  const hourlyRate = adultBaseRate * (age_percentage / 100);
  const cost = (weightedMinutes * paidRatio * hourlyRate) / 60;

  return {
    rostered_minutes: rosteredMinutes,
    paid_minutes: paidMinutes,
    cost: Math.round(cost * 100) / 100,
    effective_multiplier: rosteredMinutes > 0
      ? Math.round((weightedMinutes / rosteredMinutes) * 1000) / 1000
      : 1,
    segments,
  };
}

/** "$183.75" — costs are always shown to the cent, since they get compared. */
export function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

/** A dollar figure as printed — "$28.69", "28.69", "28,69" — cleaned to a
 *  number, or null if it doesn't look like a real hourly rate. */
export function parseDollarAmount(raw: string): number | null {
  const cleaned = (raw ?? '').trim().replace(/[$\s]/g, '').replace(',', '.');
  const value = Number(cleaned);
  if (!cleaned || !Number.isFinite(value) || value <= 0) return null;
  // A plausibility band: a base award rate outside this is almost certainly
  // a misread (a weekly total, a percentage, or the wrong cell entirely).
  if (value < 10 || value > 100) return null;
  return Math.round(value * 100) / 100;
}

/**
 * Find the adult ordinary Mon-Fri rate in a CSV export of the wage table.
 * Column names aren't fixed — looks for a column mentioning "rate", "base"
 * or "adult", falling back to the first cell in an "Adult" row that reads
 * as a plausible dollar figure.
 */
export function csvRowsToBaseRate(rows: Record<string, string>[]): number | null {
  for (const row of rows) {
    const entries = Object.entries(row);
    const isAdultRow = entries.some(([k, v]) => /adult/i.test(k) || /adult/i.test(v ?? ''));
    const rateEntry = entries.find(([k]) => /rate|base|adult|hourly/i.test(k));
    if (rateEntry) {
      const parsed = parseDollarAmount(rateEntry[1] ?? '');
      if (parsed) return parsed;
    }
    if (isAdultRow) {
      for (const [, v] of entries) {
        const parsed = parseDollarAmount(v ?? '');
        if (parsed) return parsed;
      }
    }
  }
  return null;
}
