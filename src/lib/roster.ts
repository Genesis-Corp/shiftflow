/**
 * Turning a rostering-app screenshot into shifts.
 *
 * The screenshot lists one day of one department: a person per row, with the
 * hours they are rostered. It does not normally show the date, so the date is
 * chosen in the app rather than guessed from the picture.
 *
 * Pure functions only — the database work lives in the import route.
 */

import { nameKey } from './availabilitySheet';

export interface ScannedRosterRow {
  /** Name as shown, which the app may have truncated with an ellipsis. */
  n: string;
  /** Rostered start and end, as printed. */
  s: string;
  e: string;
  /** Status chip, when the screenshot shows one. */
  st?: string;
}

export interface RosterEntry {
  name: string;
  /** "HH:MM:00", or null when the time could not be read. */
  start_time: string | null;
  end_time: string | null;
  status: string | null;
  /** The app cut the name off, so it can only be matched on its beginning. */
  truncated: boolean;
}

export interface ParsedRoster {
  entries: RosterEntry[];
  warnings: string[];
}

const ELLIPSIS = /(…|\.{2,})\s*$/;

/** "11:00", "9:30", "5:00 PM" and "5pm" all mean a time of day. */
export function parseClockTime(raw: string): string | null {
  const text = (raw ?? '').replace(/ /g, ' ').trim();
  const m = text.match(/^(\d{1,2})(?:[:.](\d{1,2}))?\s*(am|pm)?$/i);
  if (!m) return null;

  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2] ?? '0', 10);
  const meridiem = m[3]?.toLowerCase();

  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  } else if (hour > 23) return null;

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

/** Clean up what came back from the screenshot, keeping what cannot be read visible. */
export function parseRoster(rows: ScannedRosterRow[]): ParsedRoster {
  const warnings: string[] = [];
  const entries: RosterEntry[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const shown = (row.n ?? '').replace(/ /g, ' ').trim();
    const name = shown.replace(ELLIPSIS, '').trim();
    if (!name) continue;

    const key = nameKey(name);
    if (seen.has(key)) {
      warnings.push(`"${name}" is listed twice — only the first shift was kept.`);
      continue;
    }
    seen.add(key);

    const start_time = parseClockTime(row.s ?? '');
    const end_time = parseClockTime(row.e ?? '');
    if (!start_time || !end_time) {
      warnings.push(`${name} — the rostered time "${row.s ?? ''} - ${row.e ?? ''}" could not be read, so no shift was made.`);
    }

    entries.push({
      name,
      start_time,
      end_time,
      status: row.st?.trim() || null,
      truncated: ELLIPSIS.test(shown),
    });
  }

  return { entries, warnings };
}

export interface NamedStaff {
  id: string;
  name: string;
}

/**
 * Find the staff member a roster line refers to.
 *
 * The screenshot truncates long names ("Md Mozammal…"), so a cut-off name is
 * matched on its beginning — but only when exactly one person matches, since
 * guessing between two would roster the wrong person.
 */
export function matchStaffName(entry: RosterEntry, staff: NamedStaff[]): NamedStaff | null {
  const key = nameKey(entry.name);
  if (!key) return null;

  const exact = staff.filter(s => nameKey(s.name) === key);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null; // two people share the name — ask rather than guess

  const prefixed = staff.filter(s => nameKey(s.name).startsWith(key));
  return prefixed.length === 1 ? prefixed[0] : null;
}

/** Pick the department whose name best fits the screenshot's heading. */
export function matchDepartment<T extends { id: string; name: string }>(
  heading: string | undefined,
  departments: T[]
): T | null {
  const key = nameKey(heading ?? '').replace(/s$/, '');
  if (!key) return null;

  const exact = departments.find(d => nameKey(d.name).replace(/s$/, '') === key);
  if (exact) return exact;

  return (
    departments.find(d => {
      const name = nameKey(d.name).replace(/s$/, '');
      return name.startsWith(key) || key.startsWith(name);
    }) ?? null
  );
}
