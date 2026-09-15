/**
 * Turning a rostering-app screenshot into shifts.
 *
 * A source lists one day, but not necessarily one department — a whole-store
 * report (like a "Daily Coverage By Role" export) lists every department in
 * one document, each as its own section. Every row carries its own department
 * where the source has more than one, so those sections can be told apart and
 * imported separately rather than dumped into a single department. The date
 * is not normally printed either, so it is chosen in the app rather than
 * guessed from the source.
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
  /** This row's own department/role heading, when the source lists more than one. */
  d?: string;
}

export interface RosterEntry {
  name: string;
  /** "HH:MM:00", or null when the time could not be read. */
  start_time: string | null;
  end_time: string | null;
  status: string | null;
  /** The app cut the name off, so it can only be matched on its beginning. */
  truncated: boolean;
  /** This row's own department/role heading, when the source read one. */
  department: string | null;
}

export interface ParsedRoster {
  entries: RosterEntry[];
  warnings: string[];
}

const ELLIPSIS = /(…|\.{2,})\s*$/;

/** "11:00", "9:30", "5:00 PM" and "5pm" all mean a time of day. */
export function parseClockTime(raw: string): string | null {
  const text = (raw ?? '').replace(/ /g, ' ').trim();
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
    const shown = (row.n ?? '').replace(/ /g, ' ').trim();
    const name = shown.replace(ELLIPSIS, '').trim();
    if (!name) continue;

    const department = row.d?.trim() || null;

    // Scoped to this row's own department — the same person can legitimately
    // appear more than once on the same day (e.g. an early shift in one
    // department, a later one in another), so only a repeat within the same
    // section counts as the source listing someone twice.
    const key = `${nameKey(name)}::${(department ?? '').toLowerCase()}`;
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
      department,
    });
  }

  return { entries, warnings };
}

export interface RosterEntryGroup {
  /** The department this group of entries is for, or null to fall back to
   *  whatever department the source (or the app) already has picked. */
  label: string | null;
  entries: RosterEntry[];
}

/**
 * Split entries by department, preserving the order departments first
 * appear in. A source with only one department (or none at all) still
 * produces a single group, so callers do not need a separate code path for
 * the common case.
 */
export function groupRosterEntries(entries: RosterEntry[], fallbackLabel: string | null = null): RosterEntryGroup[] {
  const order: (string | null)[] = [];
  const buckets = new Map<string | null, RosterEntry[]>();

  for (const entry of entries) {
    const label = entry.department ?? fallbackLabel;
    if (!buckets.has(label)) {
      buckets.set(label, []);
      order.push(label);
    }
    buckets.get(label)!.push(entry);
  }

  return order.map(label => ({ label, entries: buckets.get(label)! }));
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

/**
 * Whether anyone on the staff list is even a candidate for this entry's
 * name — exact or prefix, matched or ambiguous. False only means nobody
 * remotely similar exists, which is the one case it's safe to add this
 * person as new staff rather than ask a human to sort it out: an ambiguous
 * match (two people sharing a name) must still go to a person, not be
 * guessed or duplicated.
 */
export function hasNameCandidate(entry: RosterEntry, staff: NamedStaff[]): boolean {
  const key = nameKey(entry.name);
  if (!key) return true;
  return staff.some(s => nameKey(s.name) === key || nameKey(s.name).startsWith(key));
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

/**
 * One photo waiting to be turned into shifts.
 *
 * Each photo is a single day in a single department, and neither is reliably
 * printed on it, so every job carries its own date and department rather than
 * inheriting a run-wide setting. Photos are read one at a time: each read is
 * its own request, which is what keeps a batch of them clear of the hosting
 * platform's per-request time limit.
 */
export interface RosterJob {
  id: string;
  /** File name, so a row in the queue is recognisable. */
  name: string;
  status: 'pending' | 'reading' | 'ready' | 'failed' | 'applied';
  error?: string;
  /** How long the read took, when it has happened. */
  seconds?: number;
  /** What the screenshot's heading said, and whether it named a known department. */
  heading?: { text: string; matched: boolean } | null;
  entries: RosterEntry[];
  warnings: string[];
  date: string;
  department_id: string;
  logNoShows: boolean;
  /** Set once the read is previewed against the staff list and existing shifts. */
  plan?: unknown;
  applied?: { shifts_created: number; incidents_logged: number };
}
