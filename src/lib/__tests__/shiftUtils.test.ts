import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  shiftsOverlap, mergeShiftRanges, clashesWithOtherShift, weekBounds, isBirthday,
  addDays, todayStr, minutesUntil, formatTimeOfDay, applyReliabilityDelta,
} from '../shiftUtils';

describe('applyReliabilityDelta', () => {
  it('shrinks a bad incident by a percentage of the current score, not a flat amount', () => {
    // -15% of 50, not a flat -15 — 43, not 35.
    expect(applyReliabilityDelta(50, 'no_show')).toBe(43);
  });

  it('compounds down over a repeated pattern, landing near where a flat deduction would have', () => {
    const afterFirst = applyReliabilityDelta(50, 'no_show');
    const afterSecond = applyReliabilityDelta(afterFirst, 'no_show');
    expect(afterFirst).toBe(43);
    expect(afterSecond).toBe(37);
  });

  it('has a smaller absolute effect on someone already low than someone starting high', () => {
    const highDrop = 100 - applyReliabilityDelta(100, 'no_show');
    const lowDrop = 20 - applyReliabilityDelta(20, 'no_show');
    expect(highDrop).toBeGreaterThan(lowDrop);
  });

  it('grows "covered" by a percentage of the remaining headroom to 100', () => {
    // +10% of the 50 points left to reach 100, not a flat +10 — 55, not 60.
    expect(applyReliabilityDelta(50, 'covered')).toBe(55);
    expect(applyReliabilityDelta(20, 'covered')).toBe(28);
  });

  it('has a smaller absolute gain close to 100 than far from it', () => {
    const highGain = applyReliabilityDelta(95, 'covered') - 95;
    const lowGain = applyReliabilityDelta(20, 'covered') - 20;
    expect(lowGain).toBeGreaterThan(highGain);
  });

  it('never lets the score leave the 0-100 range', () => {
    expect(applyReliabilityDelta(100, 'covered')).toBe(100);
    expect(applyReliabilityDelta(1, 'no_show')).toBeGreaterThanOrEqual(0);
  });

  it('is a no-op for an unrecognised incident type', () => {
    expect(applyReliabilityDelta(50, 'not_a_real_type')).toBe(50);
  });
});

describe('formatTimeOfDay', () => {
  it('drops the minutes on the hour', () => {
    expect(formatTimeOfDay('09:00')).toBe('9am');
    expect(formatTimeOfDay('00:00')).toBe('12am');
    expect(formatTimeOfDay('12:00')).toBe('12pm');
  });

  it('keeps the minutes off the hour', () => {
    expect(formatTimeOfDay('17:30')).toBe('5:30pm');
    expect(formatTimeOfDay('09:05')).toBe('9:05am');
  });
});

describe('minutesUntil', () => {
  it('is positive when the target is later the same day', () => {
    expect(minutesUntil('2026-09-19', '13:00', '2026-09-19', '11:30')).toBe(90);
  });

  it('is negative once the target has passed', () => {
    expect(minutesUntil('2026-09-19', '10:30', '2026-09-19', '11:00')).toBe(-30);
  });

  it('crosses a day boundary correctly', () => {
    expect(minutesUntil('2026-09-20', '01:00', '2026-09-19', '23:00')).toBe(120);
  });
});

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

describe('clashesWithOtherShift', () => {
  it('is true when the proposed range reaches into another same-day shift', () => {
    // A split shift: 09:00-12:00 and 15:30-21:15. Extending the evening
    // part out to 13:00 would reach back into the morning part.
    const otherShifts = [{ start_time: '09:00', end_time: '12:00' }];
    expect(clashesWithOtherShift('11:00', '21:15', otherShifts)).toBe(true);
  });

  it('is false when the proposed range stays clear of the other shift', () => {
    const otherShifts = [{ start_time: '09:00', end_time: '12:00' }];
    expect(clashesWithOtherShift('15:30', '21:15', otherShifts)).toBe(false);
  });

  it('is false when there are no other shifts that day', () => {
    expect(clashesWithOtherShift('15:30', '21:15', [])).toBe(false);
  });

  it('touching endpoints do not count as a clash', () => {
    const otherShifts = [{ start_time: '09:00', end_time: '12:00' }];
    expect(clashesWithOtherShift('12:00', '18:00', otherShifts)).toBe(false);
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

describe('isBirthday', () => {
  it('matches month and day regardless of birth year', () => {
    expect(isBirthday('1998-09-18', '2026-09-18')).toBe(true);
  });

  it('is false for a different day', () => {
    expect(isBirthday('1998-09-18', '2026-09-19')).toBe(false);
  });

  it('is false when there is no birthday on file', () => {
    expect(isBirthday(null, '2026-09-18')).toBe(false);
    expect(isBirthday(undefined, '2026-09-18')).toBe(false);
  });
});

describe('addDays', () => {
  const originalTZ = process.env.TZ;
  afterEach(() => { process.env.TZ = originalTZ; });

  it('steps forward and back by one day in UTC', () => {
    process.env.TZ = 'UTC';
    expect(addDays('2026-09-18', 1)).toBe('2026-09-19');
    expect(addDays('2026-09-18', -1)).toBe('2026-09-17');
  });

  it('steps forward and back by one day in a positive UTC offset (Perth, +8)', () => {
    // Regression test: round-tripping through toISOString() (always UTC)
    // used to shift the result by a day here — "next" looked like a no-op
    // and "previous" landed two days back on the Shifts timeline.
    process.env.TZ = 'Australia/Perth';
    expect(addDays('2026-09-18', 1)).toBe('2026-09-19');
    expect(addDays('2026-09-18', -1)).toBe('2026-09-17');
  });

  it('steps forward and back by one day in a negative UTC offset (Los Angeles, -7/-8)', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(addDays('2026-09-18', 1)).toBe('2026-09-19');
    expect(addDays('2026-09-18', -1)).toBe('2026-09-17');
  });

  it('crosses a month boundary', () => {
    process.env.TZ = 'Australia/Perth';
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });
});

describe('todayStr', () => {
  const originalTZ = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTZ;
    vi.useRealTimers();
  });

  it('returns the local calendar date, not the UTC one, early in the morning', () => {
    // 11pm UTC on the 18th is already 7am on the 19th in Perth (+8) —
    // this is the exact "someone opens the app at 6am" case: the old
    // new Date().toISOString().split('T')[0] pattern would have reported
    // the 18th here, a day behind.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-18T23:00:00Z'));
    process.env.TZ = 'Australia/Perth';
    expect(todayStr()).toBe('2026-09-19');
  });

  it('matches the UTC date when running in UTC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-18T23:00:00Z'));
    process.env.TZ = 'UTC';
    expect(todayStr()).toBe('2026-09-18');
  });
});
