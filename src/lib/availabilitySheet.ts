/**
 * Parser for the printed staff availability sheet.
 *
 * Layout (as uploaded):
 *   NAME (first) | NAME (last) | MOBILE # | SUNDAY | MONDAY | ... | SATURDAY
 *
 * The sheet also carries section banner rows ("STORE", "Juniors / -18") which
 * label the block beneath them instead of describing a person.
 *
 * Everything here is pure — no database access — so parsing can be reasoned
 * about on its own. The database diff/apply lives in staffSync.ts.
 */

import { AgeGroup } from './types';

export const SHEET_DAYS = [
  'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY',
] as const;

/** Banner rows that label a section rather than name a person. */
const SECTION_LABEL = /^(store|juniors?|seniors?|adults?|staff|team|managers?|supervisors?)$/i;
/** Age markers used on banner rows, e.g. "-18" or "18+". */
const AGE_LABEL = /^[-–—]?\s*\d{1,2}\s*\+?$/;
/** Marks a character a photo transcription could not make out. */
const ILLEGIBLE = /\?/;

/** Header captions for columns that precede the day columns but hold no name. */
const NON_NAME_HEADER = /^(store|section|dept|department|#|no\.?|id|index)$/i;

const PHONE_HEADER = /(mobile|phone|contact|cell)/i;

/**
 * One day cell:
 *  - `available`   a readable time range, e.g. "6AM-2PM"
 *  - `unavailable` an empty cell — the staff member cannot work that day
 *  - `unreadable`  text we cannot turn into times, e.g. "NIGHTFILL" or "MEAT"
 */
export type DayCellKind = 'available' | 'unavailable' | 'unreadable';

export interface DayCell {
  raw: string;
  kind: DayCellKind;
  start_time?: string; // "HH:MM:00"
  end_time?: string;   // "HH:MM:00"
}

export interface SheetLayout {
  headerRow: number;
  firstNameCol: number;
  lastNameCol: number | null;
  phoneCol: number | null;
  /** day index (0 = Sunday) → column index */
  dayCols: Record<number, number>;
}

export interface SheetStaffRow {
  /** 1-based row number in the uploaded file, for error messages. */
  rowNumber: number;
  first_name: string;
  last_name: string;
  name: string;
  /** Normalised name used to match this person against the app's staff list. */
  key: string;
  phone: string | null;
  /** A mobile the camera could not read fully; the stored number is kept. */
  phone_unreadable: boolean;
  /** Derived from the section banner above the row; only used when creating. */
  age_group: AgeGroup;
  days: Record<number, DayCell>;
}

export interface ParsedSheet {
  layout: SheetLayout | null;
  staff: SheetStaffRow[];
  warnings: string[];
  errors: string[];
  /**
   * True when a row could not be read at all. The sheet is then an incomplete
   * picture of the roster, so it must not be used to decide who has left.
   */
  incomplete: boolean;
}

// ── Cell-level helpers ────────────────────────────────────────────────────────

/** Excel exports carry non-breaking spaces; flatten whitespace before matching. */
function clean(value: string | undefined | null): string {
  return (value ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/** Spreadsheet-style column label, for human-readable layout messages. */
export function columnLabel(index: number): string {
  let label = '';
  let n = index;
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

/**
 * Matches one time range. Minutes may be written with "." or ":" ("4.30PM"),
 * the meridiem may be missing from the first half ("6-2PM"), and the separator
 * may be a hyphen, dash or the word "to".
 */
const TIME_RANGE =
  /^(\d{1,2})(?:[.:](\d{1,2}))?\s*(AM|PM)?\s*(?:-|–|—|to|till|until)\s*(\d{1,2})(?:[.:](\d{1,2}))?\s*(AM|PM)?$/i;

function toMinutes(hour: number, minute: number, meridiem?: string): number | null {
  if (minute > 59) return null;
  let h = hour;
  if (meridiem) {
    const pm = meridiem.toUpperCase() === 'PM';
    if (h < 1 || h > 12) return null;
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
  } else if (h > 23) return null;
  return h * 60 + minute;
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/** Parse "6AM-2PM" / "4.30PM-9PM" / "8AM - 5PM" → { start, end } as "HH:MM:00". */
export function parseTimeRange(raw: string): { start: string; end: string } | null {
  const m = clean(raw).match(TIME_RANGE);
  if (!m) return null;

  const [, startHour, startMin, startMeridiem, endHour, endMin, endMeridiem] = m;
  const end = toMinutes(parseInt(endHour, 10), parseInt(endMin ?? '0', 10), endMeridiem);
  if (end === null) return null;

  let start = toMinutes(parseInt(startHour, 10), parseInt(startMin ?? '0', 10), startMeridiem);
  // "6-2PM": infer the missing meridiem from whichever reading runs forwards.
  if (start !== null && !startMeridiem && endMeridiem && start >= end) {
    const asPm = toMinutes(parseInt(startHour, 10), parseInt(startMin ?? '0', 10), 'PM');
    if (asPm !== null && asPm < end) start = asPm;
  }
  if (start === null) return null;

  return { start: formatTime(start), end: formatTime(end) };
}

/**
 * Normalise a mobile number so re-uploads of the same sheet compare equal.
 * Spreadsheets routinely drop the leading zero from Australian mobiles
 * ("480754051"), so put it back; leave anything that is not a recognisable
 * local number exactly as it was typed.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const text = clean(raw);
  if (!text) return null;

  let digits = text.replace(/\D/g, '');
  if (!digits) return null;

  if (digits.length === 11 && digits.startsWith('61')) digits = `0${digits.slice(2)}`;
  if (digits.length === 9 && digits.startsWith('4')) digits = `0${digits}`;

  if (digits.length === 10 && digits.startsWith('0')) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return text;
}

/** Key used to match a sheet row against an existing staff record. */
export function nameKey(name: string): string {
  return clean(name).toLowerCase();
}

export function fullName(first: string, last: string): string {
  return clean(`${first} ${last}`);
}

// ── Sheet-level parsing ───────────────────────────────────────────────────────

/** Locate the header row and work out which column holds what. */
export function detectLayout(rows: string[][]): SheetLayout | null {
  const limit = Math.min(rows.length, 15);

  for (let r = 0; r < limit; r++) {
    const row = rows[r] ?? [];
    const dayCols: Record<number, number> = {};

    row.forEach((cell, c) => {
      const day = SHEET_DAYS.indexOf(clean(cell).toUpperCase() as typeof SHEET_DAYS[number]);
      if (day !== -1 && !(day in dayCols)) dayCols[day] = c;
    });

    // A header row names most of the week; a stray "MONDAY" note does not.
    if (Object.keys(dayCols).length < 4) continue;

    const firstDayCol = Math.min(...Object.values(dayCols));
    const phoneColIndex = row.findIndex((cell, c) => c < firstDayCol && PHONE_HEADER.test(clean(cell)));
    const phoneCol = phoneColIndex === -1 ? null : phoneColIndex;

    const nameCols: number[] = [];
    for (let c = 0; c < firstDayCol; c++) {
      if (c === phoneCol) continue;
      if (NON_NAME_HEADER.test(clean(row[c]))) continue;
      nameCols.push(c);
    }
    if (!nameCols.length) continue;

    return {
      headerRow: r,
      firstNameCol: nameCols[0],
      lastNameCol: nameCols.length > 1 ? nameCols[1] : null,
      phoneCol,
      dayCols,
    };
  }

  return null;
}

/** True when the uploaded file looks like the staff availability sheet. */
export function isAvailabilitySheet(rows: string[][]): boolean {
  return detectLayout(rows) !== null;
}

/** Human-readable description of the detected columns, shown before applying. */
export function describeLayout(layout: SheetLayout): string {
  const parts = [
    `first name ${columnLabel(layout.firstNameCol)}`,
    layout.lastNameCol !== null ? `last name ${columnLabel(layout.lastNameCol)}` : 'last name not found',
    layout.phoneCol !== null ? `mobile ${columnLabel(layout.phoneCol)}` : 'mobile not found',
  ];
  const days = Object.entries(layout.dayCols)
    .map(([day, col]) => `${SHEET_DAYS[Number(day)].slice(0, 3)} ${columnLabel(col)}`)
    .join(', ');
  return `${parts.join(', ')}; ${days}`;
}

function sectionAgeGroup(label: string): AgeGroup | null {
  const text = clean(label);
  if (/junior/i.test(text) || AGE_LABEL.test(text)) return 'junior';
  if (SECTION_LABEL.test(text)) return 'senior';
  return null;
}

/**
 * Read the sheet into one record per staff member.
 * Section banner rows ("STORE", "Juniors -18") are skipped, but they do set the
 * age group used for people created from the rows beneath them.
 */
export function parseSheet(rows: string[][]): ParsedSheet {
  const warnings: string[] = [];
  const errors: string[] = [];

  const layout = detectLayout(rows);
  if (!layout) {
    return {
      layout: null,
      staff: [],
      errors: ['Could not find the header row — expected columns for the name, mobile number and each day of the week.'],
      warnings,
      incomplete: true,
    };
  }

  const staff: SheetStaffRow[] = [];
  const seen = new Map<string, number>();
  let ageGroup: AgeGroup = 'senior';
  let incomplete = false;

  for (let r = layout.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const rowNumber = r + 1;

    const first = clean(row[layout.firstNameCol]);
    const last = layout.lastNameCol === null ? '' : clean(row[layout.lastNameCol]);
    const phoneRaw = layout.phoneCol === null ? '' : clean(row[layout.phoneCol]);
    const dayValues = Object.entries(layout.dayCols).map(([day, col]) => [Number(day), clean(row[col])] as const);

    // Section banner: a label in the name columns, no contact details.
    const sectionFrom = sectionAgeGroup(first) ?? (first ? null : sectionAgeGroup(last));
    if (sectionFrom && !phoneRaw) {
      ageGroup = sectionFrom;
      continue;
    }

    if (!first && !last) continue; // blank spacer row

    // A half-read name would be matched as a different person — which would add
    // one staff member and drop another. Skip the row instead.
    if (ILLEGIBLE.test(first) || ILLEGIBLE.test(last)) {
      incomplete = true;
      errors.push(`Row ${rowNumber}: the name "${fullName(first, last)}" could not be read. That row was skipped.`);
      continue;
    }

    const name = fullName(first, last);
    const key = nameKey(name);

    const previous = seen.get(key);
    if (previous !== undefined) {
      incomplete = true;
      errors.push(`Row ${rowNumber}: "${name}" also appears on row ${previous} — only the first entry was used.`);
      continue;
    }
    seen.set(key, rowNumber);

    const days: Record<number, DayCell> = {};
    for (const [day, raw] of dayValues) {
      if (!raw) {
        days[day] = { raw: '', kind: 'unavailable' };
        continue;
      }
      const parsed = parseTimeRange(raw);
      if (parsed) {
        days[day] = { raw, kind: 'available', start_time: parsed.start, end_time: parsed.end };
      } else {
        days[day] = { raw, kind: 'unreadable' };
        warnings.push(
          `${name} — ${SHEET_DAYS[day]} reads "${raw}", which is not a time range. That day was left unchanged.`
        );
      }
    }
    // Days missing from the sheet entirely are left alone rather than cleared.
    for (let day = 0; day < 7; day++) {
      if (!(day in days)) days[day] = { raw: '', kind: 'unreadable' };
    }

    const phoneUnreadable = ILLEGIBLE.test(phoneRaw);
    if (phoneUnreadable) {
      warnings.push(`${name} — the mobile number could not be read in full. The stored number was left unchanged.`);
    }

    staff.push({
      rowNumber,
      first_name: first,
      last_name: last,
      name,
      key,
      phone: phoneUnreadable ? null : normalizePhone(phoneRaw),
      phone_unreadable: phoneUnreadable,
      age_group: ageGroup,
      days,
    });
  }

  if (!staff.length) {
    errors.push('No staff rows were found beneath the header row.');
    incomplete = true;
  }

  return { layout, staff, warnings, errors, incomplete };
}

/** Column keys used when a transcribed photo is laid out as a grid. */
export const SHEET_FIELDS = ['first_name', 'last_name', 'mobile', ...SHEET_DAYS.map(d => d.toLowerCase())];

/**
 * Lay transcribed rows out as the grid `parseSheet` expects, with the same
 * header the printed sheet uses (the name caption spans two columns).
 */
export function rowsToMatrix(rows: Record<string, string>[]): string[][] {
  const header = ['NAME', '', 'MOBILE #', ...SHEET_DAYS];
  return [header, ...rows.map(row => SHEET_FIELDS.map(field => clean(row[field])))];
}

/** Turn `[["name","phone"],["Sam","0400"]]` into row objects for the standard CSV importer. */
export function matrixToObjects(rows: string[][]): Record<string, string>[] {
  if (!rows.length) return [];
  const headers = rows[0].map(h => clean(h));
  return rows.slice(1).map(row => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) obj[h] = clean(row[i]); });
    return obj;
  });
}
