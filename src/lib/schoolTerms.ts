import { addDays, daysBetween } from './shiftUtils';

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
  /**
   * The break after the document's final term, whose end the document never
   * states — inferred from when its own school year starts. Flagged so a
   * manager is asked to confirm it rather than told it was read off the page.
   */
  estimated?: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A page that labels its breaks "Break" has told us nothing a list can be
 *  read by — those get named after the term they follow instead. */
const UNHELPFUL_NAME = /^(term\s*)?(break|breaks|holiday|holidays|school\s*holidays?|vacation|vacations)$/i;

/** First term start to last term end on a page covering a full school year.
 *  Australia's runs ~319 days; the shortest plausible is comfortably above
 *  this, and half a year's worth of terms is comfortably below. */
const FULL_SCHOOL_YEAR_DAYS = 300;

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
      // Part-inferred is still inferred — the merged range keeps asking to
      // be confirmed rather than inheriting the certainty of its first half.
      if (range.estimated) last.estimated = true;
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
  // anything derived for the same start date. Their names often aren't
  // (every row on a WA term dates page is called "Break"), so a name that
  // says nothing is replaced by one naming the term it follows.
  for (const e of usable.filter(e => e.kind === 'holiday')) {
    const given = e.name.trim();
    const precedingTerm = terms.filter(t => t.end_date < e.start_date).pop();
    const useGiven = given && !UNHELPFUL_NAME.test(given);
    byStart.set(e.start_date, {
      start_date: e.start_date,
      end_date: e.end_date,
      name: useGiven
        ? given
        : precedingTerm
          ? breakName(precedingTerm, e.start_date, e.end_date)
          : `School holidays ${e.start_date.slice(0, 4)}`,
    });
  }

  const trailing = trailingBreak(terms, byStart);
  if (trailing) byStart.set(trailing.start_date, trailing);

  return mergeHolidayRanges(Array.from(byStart.values()));
}

/**
 * The break after the last term on the page — in Australia the summer
 * holidays, and the longest and busiest of the year for a supermarket.
 *
 * A single year's table never states when it ends, because school goes back
 * in the *next* year's table. Leaving it out entirely (as this did at first)
 * is the worst of the options: every weekday of January then looks like a
 * school day and juniors silently stop being offered morning shifts over the
 * whole summer. So it's inferred from when this document's own school year
 * begins — term structure repeats annually — and flagged for confirmation.
 * A multi-year page needs none of this: the gap to the next year's first
 * term is a real pair, already derived above.
 */
function trailingBreak(
  terms: ScannedTermEntry[],
  alreadyCovered: Map<string, SchoolHolidayRange>
): SchoolHolidayRange | null {
  const last = terms[terms.length - 1];
  if (!last) return null;

  // Only infer from a document that showed a whole school year. A partial
  // one — someone screenshotting half a table — would otherwise produce a
  // break running from its last term all the way to the next year's start,
  // months long, marking juniors free for a whole stretch they're at school.
  // Skipping it errs the safe way: they stay restricted until it's added.
  if (daysBetween(terms[0].start_date, last.end_date) < FULL_SCHOOL_YEAR_DAYS) return null;

  const start = addDays(last.end_date, 1);
  if (alreadyCovered.has(start)) return null;

  // Terms are sorted, so the first one starts the school year.
  const yearStart = terms[0].start_date.slice(5);
  let resumes = `${start.slice(0, 4)}-${yearStart}`;
  if (resumes <= start) resumes = `${Number(start.slice(0, 4)) + 1}-${yearStart}`;

  const end = addDays(resumes, -1);
  if (end < start) return null;

  return { start_date: start, end_date: end, name: breakName(last, start, end), estimated: true };
}
