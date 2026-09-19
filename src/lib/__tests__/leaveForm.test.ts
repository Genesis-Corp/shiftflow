import { describe, it, expect } from 'vitest';
import { matchStaffName } from '../leaveForm';

const staff = [
  { id: '1', name: 'Sarah Waipouri' },
  { id: '2', name: 'Eli Thompson' },
  { id: '3', name: 'Aria Benino' },
  { id: '4', name: 'Aria Nguyen' },
];

describe('matchStaffName', () => {
  it('matches an exact full name, case-insensitively', () => {
    expect(matchStaffName('sarah waipouri', staff)).toBe('1');
  });

  it('matches a first-name-only reading when exactly one staff member shares it', () => {
    expect(matchStaffName('Eli', staff)).toBe('2');
  });

  it('refuses to guess when the first name is ambiguous', () => {
    expect(matchStaffName('Aria', staff)).toBeNull();
  });

  it('returns null for a name matching nobody', () => {
    expect(matchStaffName('Bob', staff)).toBeNull();
  });

  it('returns null for an empty name', () => {
    expect(matchStaffName('', staff)).toBeNull();
    expect(matchStaffName('   ', staff)).toBeNull();
  });
});
