import { timeToMinutes, minutesToTime, dayOfWeekFromDate, shiftDurationMinutes } from './shiftUtils';

/**
 * What a shift costs to fill, per person.
 *
 * Pure functions only — no database. The Cover Shift flow shows these figures
 * to a manager who then picks someone partly on price, so every number here is
 * acted on: it is worth the unit tests.
 *
 * Two rules that both cover the same minute do not stack. The higher
 * multiplier wins, which is how the award reads — a Saturday evening is paid
 * the Saturday rate, not Saturday x evening.
 */

export interface PenaltyRule {
  id: string;
  name: string;
  /** 0 = Sunday .. 6 = Saturday. */
  days: number[];
  start_time: string;
  /** May be "24:00" for a rule running to midnight. */
  end_time: string;
  multiplier: number;
  active: boolean;
}

export interface ShiftCostInput {
  date: string;
  start_time: string;
  end_time: string;
  /** Meal breaks are unpaid, so they come off the paid total. */
  unpaid_break_minutes?: number;
  base_hourly_rate: number;
}

export interface CostSegment {
  start: string;
  end: string;
  minutes: number;
  multiplier: number;
  /** Which rule set this segment's multiplier, or null for ordinary time. */
  rule: string | null;
}

export interface ShiftCost {
  /** Time on the clock, before the unpaid break comes off. */
  rostered_minutes: number;
  paid_minutes: number;
  cost: number;
  /** Weighted average loading across the shift — 1.0 is all ordinary time. */
  effective_multiplier: number;
  segments: CostSegment[];
}

/** Minutes from midnight, accepting "HH:MM", "HH:MM:SS" and "24:00". */
function toMinutes(time: string): number {
  return timeToMinutes(time.slice(0, 5));
}

/**
 * The highest multiplier covering a given moment, expressed as minutes from
 * midnight of the shift's own date — so a shift running past midnight picks
 * up the following day's rules for the minutes after it.
 */
function ruleAt(minuteOfShiftDate: number, shiftDow: number, rules: PenaltyRule[]): PenaltyRule | null {
  const dayOffset = Math.floor(minuteOfShiftDate / (24 * 60));
  const dow = (shiftDow + dayOffset) % 7;
  const withinDay = minuteOfShiftDate - dayOffset * 24 * 60;

  let best: PenaltyRule | null = null;
  for (const rule of rules) {
    if (!rule.active) continue;
    if (!rule.days.includes(dow)) continue;
    if (withinDay < toMinutes(rule.start_time) || withinDay >= toMinutes(rule.end_time)) continue;
    if (!best || rule.multiplier > best.multiplier) best = rule;
  }
  return best;
}

/**
 * Split the shift at every rule boundary it crosses, so a 15:00-21:00 weekday
 * shift is costed as ordinary time to 18:00 and evening rate after it, rather
 * than being forced into one rate or the other.
 */
export function calculateShiftCost(input: ShiftCostInput, rules: PenaltyRule[]): ShiftCost {
  const { date, start_time, end_time, base_hourly_rate } = input;
  const unpaidBreak = input.unpaid_break_minutes ?? 0;

  const shiftDow = dayOfWeekFromDate(date);
  const startM = toMinutes(start_time);
  const rosteredMinutes = shiftDurationMinutes(start_time.slice(0, 5), end_time.slice(0, 5));
  const endM = startM + rosteredMinutes;

  // Every point the applicable rate could change: the shift's own ends, plus
  // each rule window edge falling inside it, on each day the shift touches.
  const boundaries = new Set<number>([startM, endM]);
  for (let dayOffset = 0; dayOffset <= Math.floor(endM / (24 * 60)); dayOffset++) {
    const base = dayOffset * 24 * 60;
    for (const rule of rules) {
      if (!rule.active) continue;
      for (const edge of [base + toMinutes(rule.start_time), base + toMinutes(rule.end_time)]) {
        if (edge > startM && edge < endM) boundaries.add(edge);
      }
    }
  }

  const points = [...boundaries].sort((a, b) => a - b);
  const segments: CostSegment[] = [];
  let weightedMinutes = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const minutes = to - from;
    if (minutes <= 0) continue;

    // Sample the middle of the segment: by construction nothing changes inside it.
    const rule = ruleAt(from + minutes / 2, shiftDow, rules);
    const multiplier = rule?.multiplier ?? 1;

    segments.push({
      start: minutesToTime(from),
      end: minutesToTime(to),
      minutes,
      multiplier,
      rule: rule?.name ?? null,
    });
    weightedMinutes += minutes * multiplier;
  }

  const paidMinutes = Math.max(0, rosteredMinutes - unpaidBreak);
  // The break comes off proportionally rather than out of one segment —
  // picking a segment to deduct it from would be arbitrary and would quietly
  // favour whichever rate we chose.
  const paidRatio = rosteredMinutes > 0 ? paidMinutes / rosteredMinutes : 0;
  const cost = (weightedMinutes * paidRatio * base_hourly_rate) / 60;

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

// ── Reading a printed wage sheet ────────────────────────────────────────────

export interface ScannedWageRow {
  /** Name as printed. */
  n: string;
  /** Hourly rate as printed — "$24.50", "24.50", "24,50". */
  r: string;
}

export interface ParsedWage {
  name: string;
  rate: number;
}

/**
 * Turn what was read off a wage sheet into usable rates, keeping anything
 * unreadable visible rather than silently dropping it — a missing rate is
 * better than a wrong one when the number decides who gets called in.
 */
export function parseWageRows(rows: ScannedWageRow[]): { wages: ParsedWage[]; warnings: string[] } {
  const wages: ParsedWage[] = [];
  const warnings: string[] = [];

  for (const row of rows) {
    const name = (row.n ?? '').replace(/ /g, ' ').trim();
    if (!name) continue;

    const raw = (row.r ?? '').trim();
    // A comma is a decimal separator on some printed sheets, never a thousands
    // separator at these amounts — nobody earns $1,234 an hour.
    const cleaned = raw.replace(/[$\s]/g, '').replace(',', '.');
    const rate = Number(cleaned);

    if (!cleaned || !Number.isFinite(rate) || rate <= 0) {
      warnings.push(`${name} — the rate "${raw}" could not be read, so it was left unchanged.`);
      continue;
    }
    // A plausibility band: an hourly rate outside this is almost certainly a
    // misread (a weekly total, or a column picked up by mistake).
    if (rate < 5 || rate > 200) {
      warnings.push(`${name} — "${raw}" does not look like an hourly rate, so it was left unchanged.`);
      continue;
    }

    wages.push({ name, rate: Math.round(rate * 100) / 100 });
  }

  return { wages, warnings };
}

/**
 * Map a CSV (parsed with a header row into plain objects) onto the same
 * {n, r} shape a photo/PDF scan produces, so it can go through the same
 * parseWageRows + name-matching pipeline. Column names aren't fixed —
 * "Name"/"Full Name" and "Rate"/"Hourly Rate"/"$/hr"/"Pay Rate" all match.
 */
export function csvRowsToScannedWageRows(rows: Record<string, string>[]): ScannedWageRow[] {
  return rows
    .map(row => {
      const entries = Object.entries(row);
      const nameEntry = entries.find(([k]) => /name/i.test(k));
      const rateEntry = entries.find(([k]) => /rate|wage|\$|hourly|pay/i.test(k));
      return { n: nameEntry?.[1] ?? '', r: rateEntry?.[1] ?? '' };
    })
    .filter(row => row.n.trim());
}
