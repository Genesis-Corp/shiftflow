import { describe, it, expect } from 'vitest';
import { calculateShiftCost, csvRowsToScannedWageRows, PenaltyRule } from '../wages';

const rule = (over: Partial<PenaltyRule> & { name: string; days: number[]; multiplier: number }): PenaltyRule => ({
  id: over.name, start_time: '00:00', end_time: '24:00', active: true, ...over,
});

const SATURDAY = rule({ name: 'Saturday', days: [6], multiplier: 1.25 });
const SUNDAY = rule({ name: 'Sunday', days: [0], multiplier: 1.5 });
const EVENING = rule({ name: 'Weekday evening', days: [1, 2, 3, 4, 5], start_time: '18:00', end_time: '24:00', multiplier: 1.25 });

// 2026-09-17 is a Thursday, 2026-09-19 a Saturday, 2026-09-20 a Sunday.
const THU = '2026-09-17';
const SAT = '2026-09-19';
const SUN = '2026-09-20';

describe('calculateShiftCost', () => {
  it('charges ordinary time when no rule applies', () => {
    const cost = calculateShiftCost(
      { date: THU, start_time: '09:00', end_time: '17:00', base_hourly_rate: 30 },
      [SATURDAY, SUNDAY, EVENING]
    );
    expect(cost.rostered_minutes).toBe(480);
    expect(cost.effective_multiplier).toBe(1);
    expect(cost.cost).toBe(240); // 8h x $30
  });

  it('applies a whole-day loading', () => {
    const cost = calculateShiftCost(
      { date: SAT, start_time: '09:00', end_time: '17:00', base_hourly_rate: 30 },
      [SATURDAY, SUNDAY, EVENING]
    );
    expect(cost.effective_multiplier).toBe(1.25);
    expect(cost.cost).toBe(300); // 8h x $30 x 1.25
  });

  it('splits a shift that crosses a loading boundary', () => {
    // 15:00-21:00 Thursday: ordinary to 18:00, evening rate after.
    const cost = calculateShiftCost(
      { date: THU, start_time: '15:00', end_time: '21:00', base_hourly_rate: 30 },
      [SATURDAY, SUNDAY, EVENING]
    );
    expect(cost.segments).toHaveLength(2);
    expect(cost.segments[0]).toMatchObject({ start: '15:00', end: '18:00', multiplier: 1, rule: null });
    expect(cost.segments[1]).toMatchObject({ start: '18:00', end: '21:00', multiplier: 1.25, rule: 'Weekday evening' });
    // 3h ordinary + 3h at 1.25 = 6.75 weighted hours x $30
    expect(cost.cost).toBe(202.5);
  });

  it('takes the higher multiplier when two rules overlap rather than stacking them', () => {
    // A Saturday evening rule would stack to 1.5625 if multiplied together.
    const saturdayEvening = rule({ name: 'Sat evening', days: [6], start_time: '18:00', end_time: '24:00', multiplier: 1.4 });
    const cost = calculateShiftCost(
      { date: SAT, start_time: '18:00', end_time: '22:00', base_hourly_rate: 30 },
      [SATURDAY, saturdayEvening]
    );
    expect(cost.effective_multiplier).toBe(1.4);
    expect(cost.cost).toBe(168); // 4h x $30 x 1.4
  });

  it('takes an unpaid break off the paid total', () => {
    const cost = calculateShiftCost(
      { date: THU, start_time: '09:00', end_time: '17:00', unpaid_break_minutes: 30, base_hourly_rate: 30 },
      []
    );
    expect(cost.rostered_minutes).toBe(480);
    expect(cost.paid_minutes).toBe(450);
    expect(cost.cost).toBe(225); // 7.5h x $30
  });

  it('deducts the break proportionally across differently-rated segments', () => {
    // 15:00-21:00 Thu with a 30m break: half the shift ordinary, half evening.
    const cost = calculateShiftCost(
      { date: THU, start_time: '15:00', end_time: '21:00', unpaid_break_minutes: 30, base_hourly_rate: 30 },
      [EVENING]
    );
    // weighted 6.75h x (330/360) paid ratio x $30
    expect(cost.cost).toBeCloseTo(185.63, 2);
  });

  it('picks up the next day rules for minutes after midnight', () => {
    // Saturday 22:00 - Sunday 02:00: 2h Saturday, 2h Sunday.
    const cost = calculateShiftCost(
      { date: SAT, start_time: '22:00', end_time: '02:00', base_hourly_rate: 30 },
      [SATURDAY, SUNDAY]
    );
    expect(cost.rostered_minutes).toBe(240);
    expect(cost.segments.map(s => s.rule)).toEqual(['Saturday', 'Sunday']);
    // 2h x 1.25 + 2h x 1.5 = 5.5 weighted hours x $30
    expect(cost.cost).toBe(165);
  });

  it('ignores an inactive rule', () => {
    const cost = calculateShiftCost(
      { date: SAT, start_time: '09:00', end_time: '17:00', base_hourly_rate: 30 },
      [{ ...SATURDAY, active: false }]
    );
    expect(cost.effective_multiplier).toBe(1);
    expect(cost.cost).toBe(240);
  });

  it('costs a Sunday at the Sunday rate', () => {
    const cost = calculateShiftCost(
      { date: SUN, start_time: '10:00', end_time: '14:00', base_hourly_rate: 28 },
      [SATURDAY, SUNDAY, EVENING]
    );
    expect(cost.cost).toBe(168); // 4h x $28 x 1.5
  });
});

describe('csvRowsToScannedWageRows', () => {
  it('matches Name/Rate columns regardless of exact header wording', () => {
    const rows = csvRowsToScannedWageRows([
      { 'Full Name': 'Aria Benino', 'Hourly Rate': '$28.50' },
      { Name: 'Isaac Di Stefano', 'Pay Rate': '24.00' },
    ]);
    expect(rows).toEqual([
      { n: 'Aria Benino', r: '$28.50' },
      { n: 'Isaac Di Stefano', r: '24.00' },
    ]);
  });

  it('drops rows with no name', () => {
    const rows = csvRowsToScannedWageRows([{ Name: '', Rate: '24.00' }]);
    expect(rows).toEqual([]);
  });
});
