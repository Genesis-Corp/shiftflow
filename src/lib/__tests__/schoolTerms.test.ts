import { describe, it, expect } from 'vitest';
import { schoolHolidaysFromScan, mergeHolidayRanges, ScannedTermEntry } from '../schoolTerms';

function term(name: string, start_date: string, end_date: string): ScannedTermEntry {
  return { kind: 'term', name, start_date, end_date };
}
function holiday(name: string, start_date: string, end_date: string): ScannedTermEntry {
  return { kind: 'holiday', name, start_date, end_date };
}

// Western Australia's published 2026 term dates — the real shape of what a
// scanned Department of Education page contains.
const WA_2026 = [
  term('Term 1', '2026-02-02', '2026-04-02'),
  term('Term 2', '2026-04-20', '2026-07-03'),
  term('Term 3', '2026-07-20', '2026-09-25'),
  term('Term 4', '2026-10-12', '2026-12-17'),
];

describe('schoolHolidaysFromScan', () => {
  it('inverts term dates into the breaks between them', () => {
    expect(schoolHolidaysFromScan(WA_2026).slice(0, 3)).toEqual([
      { start_date: '2026-04-03', end_date: '2026-04-19', name: 'Term 1 holidays 2026' },
      { start_date: '2026-07-04', end_date: '2026-07-19', name: 'Term 2 holidays 2026' },
      { start_date: '2026-09-26', end_date: '2026-10-11', name: 'Term 3 holidays 2026' },
    ]);
  });

  it('leaves out the stretch before the first term, which the page says nothing about', () => {
    expect(schoolHolidaysFromScan(WA_2026)[0].start_date).toBe('2026-04-03');
  });

  it('estimates the summer break after the last term from when the school year starts', () => {
    // A single year's table never says when school goes back — that's in the
    // next year's table. Term 1 2026 opened on 2 Feb, so 1 Feb 2027 is the
    // best available read on the end of the break after Term 4.
    expect(schoolHolidaysFromScan(WA_2026).at(-1)).toEqual({
      start_date: '2026-12-18',
      end_date: '2027-02-01',
      name: 'Summer holidays 2026/27',
      estimated: true,
    });
  });

  it('marks only the trailing break as estimated — the rest were read off the page', () => {
    const result = schoolHolidaysFromScan(WA_2026);
    expect(result.filter(r => r.estimated)).toHaveLength(1);
    expect(result.slice(0, -1).every(r => !r.estimated)).toBe(true);
  });

  it('needs no estimate when the page carries the next year, since that gap is a real pair', () => {
    const twoYears = [...WA_2026, term('Term 1', '2027-02-01', '2027-04-09')];
    const summer = schoolHolidaysFromScan(twoYears).find(r => r.start_date === '2026-12-18');
    expect(summer).toEqual({
      start_date: '2026-12-18', end_date: '2027-01-31', name: 'Summer holidays 2026/27',
    });
  });

  it('names a break that crosses the year boundary as the summer holidays', () => {
    const across = [term('Term 4', '2026-10-12', '2026-12-17'), term('Term 1', '2027-02-01', '2027-04-09')];
    expect(schoolHolidaysFromScan(across)).toEqual([
      { start_date: '2026-12-18', end_date: '2027-01-31', name: 'Summer holidays 2026/27' },
    ]);
  });

  it('reads a page that lists terms and breaks side by side, naming the breaks usefully', () => {
    // Exactly what WA's 2027 table contains: every break row is labelled
    // just "Break", which tells a manager reading the list nothing.
    const wa2027: ScannedTermEntry[] = [
      term('Term 1', '2027-02-01', '2027-04-09'),
      holiday('Break', '2027-04-10', '2027-04-25'),
      term('Term 2', '2027-04-26', '2027-07-02'),
      holiday('Break', '2027-07-03', '2027-07-18'),
      term('Term 3', '2027-07-19', '2027-09-24'),
      holiday('Break', '2027-09-25', '2027-10-10'),
      term('Term 4', '2027-10-11', '2027-12-16'),
    ];

    expect(schoolHolidaysFromScan(wa2027)).toEqual([
      { start_date: '2027-04-10', end_date: '2027-04-25', name: 'Term 1 holidays 2027' },
      { start_date: '2027-07-03', end_date: '2027-07-18', name: 'Term 2 holidays 2027' },
      { start_date: '2027-09-25', end_date: '2027-10-10', name: 'Term 3 holidays 2027' },
      { start_date: '2027-12-17', end_date: '2028-01-31', name: 'Summer holidays 2027/28', estimated: true },
    ]);
  });

  it('keeps a break name that actually says something', () => {
    const named = [term('Term 1', '2027-02-01', '2027-04-09'), holiday('Easter break', '2027-04-10', '2027-04-25')];
    expect(schoolHolidaysFromScan(named)[0].name).toBe('Easter break');
  });

  it('takes holiday ranges as published when the page lists those directly', () => {
    expect(schoolHolidaysFromScan([holiday('Winter break', '2026-07-04', '2026-07-19')])).toEqual([
      { start_date: '2026-07-04', end_date: '2026-07-19', name: 'Winter break' },
    ]);
  });

  it('prefers a published holiday over one derived from the terms around it', () => {
    const mixed = [...WA_2026, holiday('Easter break (extended)', '2026-04-03', '2026-04-26')];
    const result = schoolHolidaysFromScan(mixed);
    expect(result.find(r => r.start_date === '2026-04-03')).toEqual({
      start_date: '2026-04-03', end_date: '2026-04-26', name: 'Easter break (extended)',
    });
    // 3 gaps between the 4 terms, plus the estimated summer break.
    expect(result).toHaveLength(4);
  });

  it('sorts terms that arrive out of order before inverting them', () => {
    const shuffled = [WA_2026[2], WA_2026[0], WA_2026[3], WA_2026[1]];
    expect(schoolHolidaysFromScan(shuffled).map(r => r.start_date)).toEqual([
      '2026-04-03', '2026-07-04', '2026-09-26', '2026-12-18',
    ]);
  });

  it('will not estimate a trailing break from a part of a year', () => {
    // Half a table screenshotted. Inferring here would invent a break from
    // July to February — juniors marked free for a whole term they're at
    // school. Better to leave it out and have it added by hand.
    const halfAYear = [term('Term 1', '2026-02-02', '2026-04-02'), term('Term 2', '2026-04-20', '2026-07-03')];
    expect(schoolHolidaysFromScan(halfAYear)).toEqual([
      { start_date: '2026-04-03', end_date: '2026-04-19', name: 'Term 1 holidays 2026' },
    ]);
  });

  it('skips entries with unreadable or reversed dates rather than storing nonsense', () => {
    const junk = [
      term('Term 1', 'not a date', '2026-04-02'),
      term('Term 2', '2026-04-20', '2026-04-19'), // ends before it starts
      holiday('', '2026-07-04', '2026-07-19'),
    ];
    expect(schoolHolidaysFromScan(junk)).toEqual([
      { start_date: '2026-07-04', end_date: '2026-07-19', name: 'School holidays 2026' },
    ]);
  });

  it('drops a gap between back-to-back terms instead of storing an empty range', () => {
    const backToBack = [term('Term 1', '2026-02-02', '2026-04-02'), term('Term 2', '2026-04-03', '2026-07-03')];
    expect(schoolHolidaysFromScan(backToBack)).toEqual([]);
  });

  it('skips entries with unreadable dates without losing the rest of the year', () => {
    const withJunk = [...WA_2026, term('Term ?', 'sometime', '2026-05-01')];
    expect(schoolHolidaysFromScan(withJunk)).toHaveLength(4);
  });

  it('returns nothing for an empty read', () => {
    expect(schoolHolidaysFromScan([])).toEqual([]);
  });
});

describe('mergeHolidayRanges', () => {
  const r = (start_date: string, end_date: string, name = 'Holidays') => ({ start_date, end_date, name });

  it('closes the one-day gap left by a summer break split at the year boundary', () => {
    // How published datasets store it: 19-30 Dec, then 1-27 Jan. Without
    // merging, 31 December belongs to no range and counts as a school day.
    expect(mergeHolidayRanges([
      r('2026-12-19', '2026-12-30', 'Term 4 holidays'),
      r('2027-01-01', '2027-01-27', 'Term 4 holidays'),
    ])).toEqual([r('2026-12-19', '2027-01-27', 'Term 4 holidays')]);
  });

  it('joins ranges that sit directly back to back', () => {
    expect(mergeHolidayRanges([r('2026-04-03', '2026-04-10'), r('2026-04-11', '2026-04-19')]))
      .toEqual([r('2026-04-03', '2026-04-19')]);
  });

  it('absorbs a range wholly inside another without shortening it', () => {
    expect(mergeHolidayRanges([r('2026-04-03', '2026-04-19'), r('2026-04-06', '2026-04-09')]))
      .toEqual([r('2026-04-03', '2026-04-19')]);
  });

  it('leaves genuinely separate breaks alone', () => {
    const separate = [r('2026-04-03', '2026-04-19', 'Term 1'), r('2026-07-04', '2026-07-19', 'Term 2')];
    expect(mergeHolidayRanges(separate)).toEqual(separate);
  });

  it('keeps a two-day teaching gap between breaks intact', () => {
    // 3 days apart: Apr 20 and Apr 21 are real school days, not an artifact.
    const separate = [r('2026-04-03', '2026-04-19'), r('2026-04-22', '2026-04-30')];
    expect(mergeHolidayRanges(separate)).toEqual(separate);
  });

  it('sorts before merging, so out-of-order ranges still join', () => {
    expect(mergeHolidayRanges([r('2027-01-01', '2027-01-27'), r('2026-12-19', '2026-12-30')]))
      .toEqual([r('2026-12-19', '2027-01-27')]);
  });

  it('does not mutate the ranges it was given', () => {
    const input = [r('2026-12-19', '2026-12-30'), r('2027-01-01', '2027-01-27')];
    mergeHolidayRanges(input);
    expect(input[0].end_date).toBe('2026-12-30');
  });
});
