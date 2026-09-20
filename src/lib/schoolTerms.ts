import { addDays } from './shiftUtils';

/**
 * Turning a read term-dates document into school holiday ranges.
 *
 * Education departments publish *term* dates (when school is in), while the
 * app stores the *holidays* (when it isn't) — so a scanned page usually needs
 * inverting: the holidays are the gaps between one term ending and the next
 * beginning. Some pages publish the holiday dates directly instead, so both
 * are accepted and an explicitly-published holiday always wins over a derived
 * one for the same start date.
 */

export interface ScannedTermEntry {
  kind: 'term' | 'holiday';
  name: string;
  start_date: string;
  end_date: string;
}

export interface SchoolHolidayRange {
  start_date: string;
  end_date: string;
  name: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isUsable(e: ScannedTermEntry): boolean {
  return ISO_DATE.test(e.start_date) && ISO_DATE.test(e.end_date) && e.end_date >= e.start_date;
}

/** "Term 3 dates" -> 3. Null when the name doesn't number a term. */
function termNumber(name: string): number | null {
  const m = name.match(/\bterm\s*([1-4])\b/i);
  return m ? Number(m[1]) : null;
}

/**
 * What to call the break that follows `term`. A gap that crosses into the
 * next year is the summer holidays ("2026/27"); otherwise it's named after
 * the term it follows, matching how education departments label them.
 */
function breakName(term: ScannedTermEntry, start: string, end: string): string {
  const startYear = start.slice(0, 4);
  if (end.slice(0, 4) !== startYear) {
    return `Summer holidays ${startYear}/${end.slice(2, 4)}`;
  }
  const n = termNumber(term.name);
  return n ? `Term ${n} holidays ${startYear}` : `School holidays ${startYear}`;
}

/**
 * Joins ranges that touch, overlap, or leave a single day between them.
 *
 * The one-day case is not hypothetical: published datasets split the summer
 * break at the year boundary (e.g. 19-30 December, then 1-27 January), which
 * leaves 31 December belonging to no range and a junior counted as being at
 * school on it. Nobody attends school for one isolated day between two
 * holiday blocks, so closing gaps that small is always the right reading.
 */
export function mergeHolidayRanges(ranges: SchoolHolidayRange[]): SchoolHolidayRange[] {
  const sorted = [...ranges].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const merged: SchoolHolidayRange[] = [];

  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start_date <= addDays(last.end_date, 2)) {
      if (range.end_date > last.end_date) last.end_date = range.end_date;
      continue;
    }
    merged.push({ ...range });
  }

  return merged;
}

/**
 * Holiday ranges from whatever a scanned page turned out to contain. Terms
 * are inverted into the gaps between them; the stretch before the first term
 * and after the last are left out, since a document only proves where the
 * terms it lists start and end, not that school was out either side of them.
 */
export function schoolHolidaysFromScan(entries: ScannedTermEntry[]): SchoolHolidayRange[] {
  const usable = entries.filter(isUsable);

  const byStart = new Map<string, SchoolHolidayRange>();

  const terms = usable
    .filter(e => e.kind === 'term')
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  for (let i = 0; i < terms.length - 1; i++) {
    const start = addDays(terms[i].end_date, 1);
    const end = addDays(terms[i + 1].start_date, -1);
    if (end < start) continue; // back-to-back terms leave no break to store
    byStart.set(start, { start_date: start, end_date: end, name: breakName(terms[i], start, end) });
  }

  // Published holiday dates are the source's own word for it — they overwrite
  // anything derived for the same start date.
  for (const e of usable.filter(e => e.kind === 'holiday')) {
    byStart.set(e.start_date, {
      start_date: e.start_date,
      end_date: e.end_date,
      name: e.name.trim() || `School holidays ${e.start_date.slice(0, 4)}`,
    });
  }

  return mergeHolidayRanges(Array.from(byStart.values()));
}
