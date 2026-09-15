import { describe, it, expect } from 'vitest';
import { buildRosterPlan, RosterStaff, ExistingShift } from '../rosterPlan';
import { RosterEntry } from '../roster';

const entry = (name: string, overrides: Partial<RosterEntry> = {}): RosterEntry => ({
  name, start_time: '09:00:00', end_time: '17:00:00', status: null, truncated: false, department: null, ...overrides,
});

describe('buildRosterPlan', () => {
  it('queues a new-staff entry for a name matching nobody at all', () => {
    const plan = buildRosterPlan('apply', '2026-09-19', 'dept-1', [entry('Biniam Abraha')], [], []);
    expect(plan.newStaff).toEqual([
      { name: 'Biniam Abraha', start_time: '09:00:00', end_time: '17:00:00', status: null },
    ]);
    expect(plan.unmatched).toHaveLength(0);
    expect(plan.creates).toHaveLength(0);
  });

  it('keeps an ambiguous name in unmatched rather than treating it as new staff', () => {
    const staff: RosterStaff[] = [
      { id: '1', name: 'Dave Smith', active: true },
      { id: '2', name: 'Dave Smith', active: true },
    ];
    const plan = buildRosterPlan('apply', '2026-09-19', 'dept-1', [entry('Dave Smith')], staff, []);
    expect(plan.unmatched).toEqual(['Dave Smith']);
    expect(plan.newStaff).toHaveLength(0);
  });

  it('still matches an existing staff member normally, unaffected by the new-staff path', () => {
    const staff: RosterStaff[] = [{ id: '1', name: 'Eli Benino', active: true }];
    const plan = buildRosterPlan('apply', '2026-09-19', 'dept-1', [entry('Eli Benino')], staff, []);
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0].staff_id).toBe('1');
    expect(plan.newStaff).toHaveLength(0);
    expect(plan.unmatched).toHaveLength(0);
  });

  it('does not treat an unreadable time as a new-staff candidate', () => {
    const plan = buildRosterPlan('apply', '2026-09-19', 'dept-1', [entry('Biniam Abraha', { start_time: null })], [], []);
    expect(plan.unreadable).toEqual(['Biniam Abraha']);
    expect(plan.newStaff).toHaveLength(0);
  });

  it('leaves existing shifts/duplicate handling for matched staff untouched', () => {
    const staff: RosterStaff[] = [{ id: '1', name: 'Eli Benino', active: true }];
    const existing: ExistingShift[] = [
      { assigned_staff_id: '1', start_time: '09:00:00', end_time: '17:00:00', department_id: 'dept-1' },
    ];
    const plan = buildRosterPlan('apply', '2026-09-19', 'dept-1', [entry('Eli Benino')], staff, existing);
    expect(plan.duplicates).toEqual([{ name: 'Eli Benino', existing: '09:00–17:00' }]);
    expect(plan.creates).toHaveLength(0);
  });
});
