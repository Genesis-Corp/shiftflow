import { describe, it, expect } from 'vitest';
import {
  calculateShiftCost, ageBracketFor, ageInYears, monthsOfService, seniorityFromBirthday,
  parseDollarAmount, csvRowsToBaseRate,
  AgeBracket, TimeLoading, EmploymentCategory, OvertimeTier, OvertimeOverride,
} from '../wages';

// Mirrors the seed data in 20260919_award_wage_matrix.sql and
// 20260920_settings_and_overtime.sql, taken directly off Farmer Jack's 2026
// Wage Table.
const ADULT_BASE_RATE = 28.69;

const AGE_BRACKETS: AgeBracket[] = [
  { id: '1', label: 'Under 16', min_age: null, max_age: 16, min_service_months: null, percentage: 45 },
  { id: '2', label: '16 to 17', min_age: 16, max_age: 17, min_service_months: null, percentage: 50 },
  { id: '3', label: '17 to 18', min_age: 17, max_age: 18, min_service_months: null, percentage: 60 },
  { id: '4', label: '18 to 19', min_age: 18, max_age: 19, min_service_months: null, percentage: 70 },
  { id: '5', label: '19 to 20', min_age: 19, max_age: 20, min_service_months: null, percentage: 80 },
  { id: '6', label: '20 to 21 under 6mo', min_age: 20, max_age: 21, min_service_months: 0, percentage: 90 },
  { id: '7', label: '20 to 21 6mo+', min_age: 20, max_age: 21, min_service_months: 6, percentage: 100 },
  { id: '8', label: 'Adult', min_age: 21, max_age: null, min_service_months: null, percentage: 100 },
];

function timeLoading(
  over: Partial<TimeLoading> & { label: string; employment_category: EmploymentCategory; percentage: number; category_group: string }
): TimeLoading {
  return {
    id: over.label + over.employment_category, days: [], start_time: '00:00', end_time: '24:00',
    is_public_holiday: false, ...over,
  };
}

const TIME_LOADINGS: TimeLoading[] = [
  timeLoading({ label: 'Before 7am (Mon-Sat)', employment_category: 'ft_pt', days: [1, 2, 3, 4, 5, 6], start_time: '00:00', end_time: '07:00', percentage: 146, category_group: 'before_open' }),
  timeLoading({ label: 'Weekday ordinary', employment_category: 'ft_pt', days: [1, 2, 3, 4, 5], start_time: '07:00', end_time: '18:00', percentage: 100, category_group: 'weekday' }),
  timeLoading({ label: 'Weekday evening', employment_category: 'ft_pt', days: [1, 2, 3, 4, 5], start_time: '18:00', end_time: '23:00', percentage: 122, category_group: 'evening' }),
  timeLoading({ label: 'Saturday ordinary', employment_category: 'ft_pt', days: [6], start_time: '07:00', end_time: '23:00', percentage: 122, category_group: 'saturday' }),
  timeLoading({ label: 'Sunday before 9am', employment_category: 'ft_pt', days: [0], start_time: '00:00', end_time: '09:00', percentage: 195, category_group: 'sunday' }),
  timeLoading({ label: 'Sunday ordinary', employment_category: 'ft_pt', days: [0], start_time: '09:00', end_time: '23:00', percentage: 150, category_group: 'sunday' }),
  timeLoading({ label: 'Public holiday', employment_category: 'ft_pt', percentage: 220, is_public_holiday: true, category_group: 'public_holiday' }),

  timeLoading({ label: 'Before 7am (Mon-Sat)', employment_category: 'casual', days: [1, 2, 3, 4, 5, 6], start_time: '00:00', end_time: '07:00', percentage: 170, category_group: 'before_open' }),
  timeLoading({ label: 'Weekday ordinary', employment_category: 'casual', days: [1, 2, 3, 4, 5], start_time: '07:00', end_time: '18:00', percentage: 122, category_group: 'weekday' }),
  timeLoading({ label: 'Weekday evening', employment_category: 'casual', days: [1, 2, 3, 4, 5], start_time: '18:00', end_time: '23:00', percentage: 146, category_group: 'evening' }),
  timeLoading({ label: 'Saturday ordinary', employment_category: 'casual', days: [6], start_time: '07:00', end_time: '23:00', percentage: 146, category_group: 'saturday' }),
  timeLoading({ label: 'Sunday before 9am', employment_category: 'casual', days: [0], start_time: '00:00', end_time: '09:00', percentage: 220, category_group: 'sunday' }),
  timeLoading({ label: 'Sunday ordinary', employment_category: 'casual', days: [0], start_time: '09:00', end_time: '23:00', percentage: 170, category_group: 'sunday' }),
  timeLoading({ label: 'Public holiday', employment_category: 'casual', percentage: 245, is_public_holiday: true, category_group: 'public_holiday' }),
];

const OVERTIME_TIERS: OvertimeTier[] = [
  { id: '1', employment_category: 'ft_pt', tier_order: 1, hours_into_overtime: 0, percentage: 150 },
  { id: '2', employment_category: 'casual', tier_order: 1, hours_into_overtime: 0, percentage: 170 },
];

const OVERTIME_OVERRIDES: OvertimeOverride[] = [
  { category_group: 'sunday', overridable: false },
];

// 2026-09-17 is a Thursday, 2026-09-19 a Saturday, 2026-09-20 a Sunday.
const THU = '2026-09-17';
const SAT = '2026-09-19';
const SUN = '2026-09-20';

function cost(
  args: { date: string; start_time: string; end_time: string; unpaid_break_minutes?: number },
  employment_category: EmploymentCategory,
  age_percentage: number,
  isPublicHoliday = false,
  tiers: OvertimeTier[] = OVERTIME_TIERS,
  overrides: OvertimeOverride[] = OVERTIME_OVERRIDES
) {
  return calculateShiftCost(
    { ...args, employment_category, age_percentage },
    ADULT_BASE_RATE,
    TIME_LOADINGS,
    isPublicHoliday,
    tiers,
    overrides
  );
}

describe('ageInYears', () => {
  it('computes age from a YYYY-MM-DD birthday', () => {
    expect(ageInYears('2008-09-18', '2026-09-18')).toBe(18);
  });

  it('has not had the birthday yet this year', () => {
    expect(ageInYears('2008-09-19', '2026-09-18')).toBe(17);
  });
});

describe('seniorityFromBirthday', () => {
  it('is senior the day someone turns 18', () => {
    expect(seniorityFromBirthday('2008-09-01', '2026-09-18')).toBe('senior');
  });

  it('is still junior the day before turning 18', () => {
    expect(seniorityFromBirthday('2008-09-19', '2026-09-18')).toBe('junior');
  });

  it('is null with no birthday on file', () => {
    expect(seniorityFromBirthday(null, '2026-09-18')).toBeNull();
    expect(seniorityFromBirthday(undefined, '2026-09-18')).toBeNull();
  });
});

describe('monthsOfService', () => {
  it('computes whole months of service', () => {
    expect(monthsOfService('2026-03-18', '2026-09-18')).toBe(6);
    expect(monthsOfService('2026-04-01', '2026-09-18')).toBe(5);
  });

  it('never goes negative for a future commencement date', () => {
    expect(monthsOfService('2026-10-01', '2026-09-18')).toBe(0);
  });
});

describe('ageBracketFor', () => {
  it('picks the matching age bracket', () => {
    expect(ageBracketFor('2010-01-01', '2026-06-01', null, AGE_BRACKETS)?.percentage).toBe(50); // just turned 16
  });

  it('splits the 20-21 bracket by service length', () => {
    const asOf = '2026-09-18';
    // Turns 20 on 2026-06-01, so 20 years old; commenced 3 months ago.
    const under6mo = ageBracketFor('2006-06-01', asOf, '2026-06-18', AGE_BRACKETS);
    expect(under6mo?.percentage).toBe(90);

    const over6mo = ageBracketFor('2006-06-01', asOf, '2026-01-01', AGE_BRACKETS);
    expect(over6mo?.percentage).toBe(100);
  });

  it('defaults an unknown commencement date to the higher (safer) rate', () => {
    const bracket = ageBracketFor('2006-06-01', '2026-09-18', null, AGE_BRACKETS);
    expect(bracket?.percentage).toBe(100);
  });

  it('returns null with no birthday on file', () => {
    expect(ageBracketFor(null, '2026-09-18', null, AGE_BRACKETS)).toBeNull();
  });

  it('matches the Adult bracket for anyone 21 or older', () => {
    expect(ageBracketFor('1990-01-01', '2026-09-18', null, AGE_BRACKETS)?.percentage).toBe(100);
  });
});

describe('calculateShiftCost — matches Farmer Jack\'s 2026 Wage Table exactly', () => {
  it('Adult, FT/PT, ordinary Mon-Fri: $28.69/hr', () => {
    const c = cost({ date: THU, start_time: '09:00', end_time: '17:00' }, 'ft_pt', 100);
    expect(c.cost).toBeCloseTo(28.69 * 8, 2);
  });

  it('Adult, Casual, ordinary Mon-Fri: $35.00/hr', () => {
    const c = cost({ date: THU, start_time: '09:00', end_time: '10:00' }, 'casual', 100);
    expect(c.cost).toBeCloseTo(35.00, 2);
  });

  it('Under 16, FT/PT, ordinary Mon-Fri: $12.91/hr', () => {
    const c = cost({ date: THU, start_time: '09:00', end_time: '10:00' }, 'ft_pt', 45);
    expect(c.cost).toBeCloseTo(12.91, 2);
  });

  it('16 to 17, Casual, Saturday: $20.94/hr', () => {
    const c = cost({ date: SAT, start_time: '09:00', end_time: '10:00' }, 'casual', 50);
    expect(c.cost).toBeCloseTo(20.94, 2);
  });

  it('16 to 17, Casual, Sunday: $24.39/hr', () => {
    const c = cost({ date: SUN, start_time: '10:00', end_time: '11:00' }, 'casual', 50);
    expect(c.cost).toBeCloseTo(24.39, 2);
  });

  it('18 to 19, Casual, Sunday: $34.14/hr', () => {
    const c = cost({ date: SUN, start_time: '10:00', end_time: '11:00' }, 'casual', 70);
    expect(c.cost).toBeCloseTo(34.14, 2);
  });

  it('20 to 21 under 6mo, FT/PT, Public Holiday: $56.81/hr', () => {
    const c = cost({ date: THU, start_time: '09:00', end_time: '10:00' }, 'ft_pt', 90, true);
    expect(c.cost).toBeCloseTo(56.81, 2);
  });

  it('Adult, FT/PT, before 7am Saturday: $41.89/hr', () => {
    const c = cost({ date: SAT, start_time: '05:00', end_time: '06:00' }, 'ft_pt', 100);
    expect(c.cost).toBeCloseTo(41.89, 2);
  });

  it('Adult, Casual, before 9am Sunday: $63.12/hr', () => {
    const c = cost({ date: SUN, start_time: '07:00', end_time: '08:00' }, 'casual', 100);
    expect(c.cost).toBeCloseTo(63.12, 2);
  });

  it('Adult, FT/PT, weekday evening: $35.00/hr', () => {
    const c = cost({ date: THU, start_time: '19:00', end_time: '20:00' }, 'ft_pt', 100);
    expect(c.cost).toBeCloseTo(35.00, 2);
  });

  it('splits a shift crossing from ordinary into evening', () => {
    // 15:00-21:00 Thursday, Adult FT/PT: 3h ordinary (100%) + 3h evening (122%).
    // Rounded once at the end, not per segment — $35.00 on the sheet is
    // itself 28.69 x 1.22 = 35.0018 rounded for display, so multiplying it
    // back out understates the true figure by a cent; use the unrounded rate.
    const c = cost({ date: THU, start_time: '15:00', end_time: '21:00' }, 'ft_pt', 100);
    expect(c.segments).toHaveLength(2);
    expect(c.segments[0]).toMatchObject({ start: '15:00', end: '18:00', rule: null });
    expect(c.segments[1]).toMatchObject({ start: '18:00', end: '21:00', rule: 'Weekday evening' });
    expect(c.cost).toBeCloseTo(28.69 * 3 + 28.69 * 1.22 * 3, 2);
  });

  it('costs the portion of a shift past 9 hours as overtime', () => {
    // 08:00-19:00 Thursday, Adult FT/PT: 9h ordinary/evening + 2h overtime (150%).
    const c = cost({ date: THU, start_time: '08:00', end_time: '19:00' }, 'ft_pt', 100);
    const otSegment = c.segments.find(s => s.rule === 'Overtime');
    expect(otSegment).toMatchObject({ start: '17:00', end: '19:00', multiplier: 1.5 });
  });

  it('overtime never undercuts a higher time-of-week rate (public holiday still wins)', () => {
    // A 10-hour public holiday shift: the whole thing stays at 220%, not
    // dropping to 150% overtime for the last hour.
    const c = cost({ date: THU, start_time: '07:00', end_time: '17:00' }, 'ft_pt', 100, true);
    expect(c.segments).toHaveLength(1);
    expect(c.segments[0].multiplier).toBe(2.2);
  });

  it('steps up to a second overtime tier after its own threshold', () => {
    // "First 3 hours of overtime at 1.5x, then 2x after that."
    const tiers: OvertimeTier[] = [
      { id: '1', employment_category: 'ft_pt', tier_order: 1, hours_into_overtime: 0, percentage: 150 },
      { id: '2', employment_category: 'ft_pt', tier_order: 2, hours_into_overtime: 3, percentage: 200 },
    ];
    // 06:00-19:00 Thursday: 9h ordinary/evening, then 3h at tier 1 (150%), then 1h at tier 2 (200%).
    const c = cost({ date: THU, start_time: '06:00', end_time: '19:00' }, 'ft_pt', 100, false, tiers, []);
    const otSegments = c.segments.filter(s => s.rule === 'Overtime');
    expect(otSegments).toEqual([
      { start: '15:00', end: '18:00', minutes: 180, multiplier: 1.5, rule: 'Overtime' },
      { start: '18:00', end: '19:00', minutes: 60, multiplier: 2, rule: 'Overtime' },
    ]);
  });

  it('does not let overtime override Sunday rates by default, even though overtime pays more', () => {
    // Sunday ordinary is 150%; overtime here is a flat 200%, which would
    // normally win on price — but Sunday is marked not-overridable, so it
    // doesn't. This mirrors real payslip behaviour: overtime replaced
    // ordinary pay, but never cut into the Sunday loading.
    const tiers: OvertimeTier[] = [{ id: '1', employment_category: 'ft_pt', tier_order: 1, hours_into_overtime: 0, percentage: 200 }];
    const c = cost({ date: SUN, start_time: '08:00', end_time: '18:00' }, 'ft_pt', 100, false, tiers, OVERTIME_OVERRIDES);
    // 9am-6pm is entirely the Sunday-ordinary bracket, so the whole overtime
    // window (from 5pm) still reads as Sunday, not Overtime.
    expect(c.segments.every(s => s.rule !== 'Overtime')).toBe(true);
    expect(c.segments[c.segments.length - 1].multiplier).toBe(1.5);
  });

  it('lets overtime override a category once the override is flipped on', () => {
    const tiers: OvertimeTier[] = [{ id: '1', employment_category: 'ft_pt', tier_order: 1, hours_into_overtime: 0, percentage: 200 }];
    const overrides: OvertimeOverride[] = [{ category_group: 'sunday', overridable: true }];
    const c = cost({ date: SUN, start_time: '08:00', end_time: '18:00' }, 'ft_pt', 100, false, tiers, overrides);
    expect(c.segments.some(s => s.rule === 'Overtime')).toBe(true);
  });

  it('categories with no override row compete normally (higher wins)', () => {
    // Evening (122%) has no override row configured; a 150% overtime tier
    // should still win there by default.
    const c = cost({ date: THU, start_time: '10:00', end_time: '20:00' }, 'ft_pt', 100, false, OVERTIME_TIERS, []);
    const otSegment = c.segments.find(s => s.rule === 'Overtime');
    expect(otSegment).toMatchObject({ multiplier: 1.5 });
  });

  it('falls back to the ordinary rate for an uncovered time (e.g. after 11pm)', () => {
    // Casual, weekday, 23:00-23:30 — past the defined Evening bracket.
    // Floor is the category's own ordinary rate (122%), not 100%.
    const c = cost({ date: THU, start_time: '23:00', end_time: '23:30' }, 'casual', 100);
    expect(c.cost).toBeCloseTo(35.00 / 2, 2); // half an hour at $35.00/hr
  });

  it('deducts an unpaid break proportionally', () => {
    const c = cost({ date: THU, start_time: '09:00', end_time: '17:00', unpaid_break_minutes: 30 }, 'ft_pt', 100);
    expect(c.paid_minutes).toBe(450);
    expect(c.cost).toBeCloseTo(28.69 * 7.5, 2);
  });
});

describe('parseDollarAmount', () => {
  it('parses a plain figure', () => {
    expect(parseDollarAmount('28.69')).toBe(28.69);
  });

  it('strips a dollar sign', () => {
    expect(parseDollarAmount('$28.69')).toBe(28.69);
  });

  it('treats a comma as a decimal separator', () => {
    expect(parseDollarAmount('28,69')).toBe(28.69);
  });

  it('rejects an implausible figure', () => {
    expect(parseDollarAmount('1200')).toBeNull();
    expect(parseDollarAmount('2')).toBeNull();
    expect(parseDollarAmount('not a number')).toBeNull();
  });
});

describe('csvRowsToBaseRate', () => {
  it('finds a rate-labelled column', () => {
    expect(csvRowsToBaseRate([{ 'Adult Base Rate': '28.69' }])).toBe(28.69);
  });

  it('falls back to a plausible figure in an Adult row', () => {
    expect(csvRowsToBaseRate([{ Category: 'Adult', 'Mon-Fri': '28.69', Saturday: '35.00' }])).toBe(28.69);
  });

  it('returns null when nothing matches', () => {
    expect(csvRowsToBaseRate([{ Category: 'Junior', Value: 'n/a' }])).toBeNull();
  });
});
