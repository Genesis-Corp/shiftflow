import { describe, it, expect } from 'vitest';
import { computeRoleType } from '../roleType';

function levels(...training_level: ('trained' | 'supervised' | 'advanced')[]) {
  return training_level.map(training_level => ({ training_level }));
}

describe('computeRoleType', () => {
  it('is department-only with no departments', () => {
    expect(computeRoleType([])).toBe('department_only');
  });

  it('is department-only with a single trained department', () => {
    expect(computeRoleType(levels('trained'))).toBe('department_only');
  });

  it('is department-only with trained departments but nothing supervised alongside them', () => {
    expect(computeRoleType(levels('trained', 'trained'))).toBe('department_only');
  });

  it('is department-only with only supervised departments', () => {
    expect(computeRoleType(levels('supervised', 'supervised'))).toBe('department_only');
  });

  it('is a potential all-rounder with 1 trained department and 1 supervised', () => {
    expect(computeRoleType(levels('trained', 'supervised'))).toBe('potential_all_rounder');
  });

  it('is a potential all-rounder with 2 trained departments and 1 supervised', () => {
    expect(computeRoleType(levels('trained', 'trained', 'supervised'))).toBe('potential_all_rounder');
  });

  it('counts advanced the same as trained for the potential all-rounder count', () => {
    expect(computeRoleType(levels('advanced', 'supervised'))).toBe('potential_all_rounder');
  });

  it('is an all-rounder with 3 trained departments', () => {
    expect(computeRoleType(levels('trained', 'trained', 'trained'))).toBe('all_rounder');
  });

  it('is an all-rounder with 3+ trained/advanced departments even alongside a supervised one', () => {
    expect(computeRoleType(levels('trained', 'trained', 'advanced', 'supervised'))).toBe('all_rounder');
  });

  it('counts advanced departments toward the all-rounder threshold', () => {
    expect(computeRoleType(levels('advanced', 'advanced', 'advanced'))).toBe('all_rounder');
  });
});
