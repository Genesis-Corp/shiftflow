import { describe, it, expect } from 'vitest';
import { timelineBarPosition, formatHour12, addDays, TIMELINE_START_HOUR, TIMELINE_END_HOUR } from '../shiftUtils';

describe('timelineBarPosition', () => {
  it('places a normal daytime shift proportionally within the 5am-10pm span', () => {
    // 9am-5pm within a 5am-10pm (17h) window: starts 4h in, spans 8h.
    const pos = timelineBarPosition('09:00', '17:00');
    expect(pos).not.toBeNull();
    expect(pos!.leftPct).toBeCloseTo((4 / 17) * 100, 5);
    expect(pos!.widthPct).toBeCloseTo((8 / 17) * 100, 5);
  });

  it('spans the full window for a 5am-10pm shift', () => {
    const pos = timelineBarPosition('05:00', '22:00');
    expect(pos!.leftPct).toBeCloseTo(0, 5);
    expect(pos!.widthPct).toBeCloseTo(100, 5);
  });

  it('clips a start before 5am to the left edge instead of overflowing', () => {
    const pos = timelineBarPosition('04:00', '11:00');
    expect(pos!.leftPct).toBe(0);
    // Visible portion is only 5am-11am (6h) of the original 4am-11am (7h).
    expect(pos!.widthPct).toBeCloseTo((6 / 17) * 100, 5);
  });

  it('clips an end after 10pm to the right edge', () => {
    const pos = timelineBarPosition('18:00', '23:30');
    const rightEdgePct = pos!.leftPct + pos!.widthPct;
    expect(rightEdgePct).toBeCloseTo(100, 5);
  });

  it('returns null for a range with no overlap with the visible window', () => {
    // Starts exactly at the right-hand edge with nothing before it clipped in.
    expect(timelineBarPosition('22:00', '23:00')).toBeNull();
  });

  it('never produces a negative width or a bar past 100%', () => {
    const cases: [string, string][] = [
      ['00:00', '23:59'], ['05:00', '05:01'], ['21:59', '22:00'], ['12:00', '12:00'],
    ];
    for (const [start, end] of cases) {
      const pos = timelineBarPosition(start, end);
      if (pos) {
        expect(pos.widthPct).toBeGreaterThanOrEqual(0);
        expect(pos.leftPct + pos.widthPct).toBeLessThanOrEqual(100.0001);
        expect(pos.leftPct).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('formatHour12', () => {
  it('formats the visible window boundaries correctly', () => {
    expect(formatHour12(TIMELINE_START_HOUR)).toBe('5am');
    expect(formatHour12(TIMELINE_END_HOUR)).toBe('10pm');
  });

  it('formats noon and midnight as 12pm/12am, not 0pm/0am', () => {
    expect(formatHour12(12)).toBe('12pm');
    expect(formatHour12(0)).toBe('12am');
  });

  it('formats afternoon hours relative to 12, not straight subtraction from 24', () => {
    expect(formatHour12(13)).toBe('1pm');
    expect(formatHour12(21)).toBe('9pm');
  });
});

describe('addDays', () => {
  it('steps forward and backward within a month', () => {
    expect(addDays('2026-09-15', 1)).toBe('2026-09-16');
    expect(addDays('2026-09-15', -1)).toBe('2026-09-14');
  });

  it('crosses a month boundary', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });

  it('crosses a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('handles February in a leap year correctly', () => {
    // 2028 is a leap year — Feb has 29 days.
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('handles February in a non-leap year correctly', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('delta of 0 is a no-op', () => {
    expect(addDays('2026-09-15', 0)).toBe('2026-09-15');
  });
});
