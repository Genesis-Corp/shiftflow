import { describe, it, expect } from 'vitest';
import { shiftsOverlap, mergeShiftRanges, weekBounds } from '../shiftUtils';

describe('shiftsOverlap', () => {
  it('is true when ranges genuinely overlap', () => {
    expect(shiftsOverlap('09:00', '14:00', '13:00', '18:00')).toBe(true);
  });

  it('is false for back-to-back shifts that only touch endpoints', () => {
    expect(shiftsOverlap('09:00', '14:00', '14:00', '18:00')).toBe(false);
  });

  it('is false for entirely separate ranges', () => {
    expect(shiftsOverlap('09:00', '12:00', '13:00', '17:00')).toBe(false);
  });

  it('is true when one range fully contains the other', () => {
    expect(shiftsOverlap('08:00', '18:00', '10:00', '12:00')).toBe(true);
  });
});

describe('mergeShiftRanges', () => {
  it('spans the earliest start to the latest end', () => {
    expect(mergeShiftRanges('09:00', '14:00', '13:00', '18:00')).toEqual({ start_time: '09:00', end_time: '18:00' });
  });

  it('handles the new shift starting before the existing one', () => {
    expect(mergeShiftRanges('12:00', '17:00', '09:00', '13:00')).toEqual({ start_time: '09:00', end_time: '17:00' });
  });

  it('is a no-op when one range fully contains the other', () => {
    expect(mergeShiftRanges('08:00', '18:00', '10:00', '12:00')).toEqual({ start_time: '08:00', end_time: '18:00' });
  });
});

describe('weekBounds', () => {
  it('finds Sunday-Saturday for a mid-week date', () => {
    // Thursday 17 Sept 2026
    expect(weekBounds('2026-09-17')).toEqual({ weekStart: '2026-09-13', weekEnd: '2026-09-19' });
  });

  it('returns the same day for a Sunday', () => {
    expect(weekBounds('2026-09-13').weekStart).toBe('2026-09-13');
  });

  it('returns the same day for a Saturday', () => {
    expect(weekBounds('2026-09-19').weekEnd).toBe('2026-09-19');
  });

  it('crosses a month boundary correctly', () => {
    // Tuesday 29 Sept 2026 — week runs into October
    expect(weekBounds('2026-09-29')).toEqual({ weekStart: '2026-09-27', weekEnd: '2026-10-03' });
  });
});
