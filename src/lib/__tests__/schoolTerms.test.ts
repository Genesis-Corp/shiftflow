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
    expect(schoolHolidaysFromScan(WA_2026)).toEqual([
      { start_date: '2026-04-03', end_date: '2026-04-19', name: 'Term 1 holidays 2026' },
      { start_date: '2026-07-04', end_date: '2026-07-19', name: 'Term 2 holidays 2026' },
      { start_date: '2026-09-26', end_date: '2026-10-11', name: 'Term 3 holidays 2026' },
    ]);
  });

  it('leaves out the stretches before the first and after the last term', () => {
    // 4 terms produce 3 gaps, not 5 — a page only proves where its own terms sit.
    expect(schoolHolidaysFromScan(WA_2026)).toHaveLength(3);
  });

  it('names a break that crosses the year boundary as the summer holidays', () => {
    const across = [term('Term 4', '2026-10-12', '2026-12-17'), term('Term 1', '2027-02-01', '2027-04-09')];
    expect(schoolHolidaysFromScan(across)).toEqual([
      { start_date: '2026-12-18', end_date: '2027-01-31', name: 'Summer holidays 2026/27' },
    ]);
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
    expect(result).toHaveLength(3);
  });

  it('sorts terms that arrive out of order before inverting them', () => {
    const shuffled = [WA_2026[2], WA_2026[0], WA_2026[3], WA_2026[1]];
    expect(schoolHolidaysFromScan(shuffled).map(r => r.start_date)).toEqual([
      '2026-04-03', '2026-07-04', '2026-09-26',
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
