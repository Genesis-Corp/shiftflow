import { describe, it, expect } from 'vitest';
import { parseRoster, groupRosterEntries, ScannedRosterRow } from '../roster';

describe('parseRoster', () => {
  it('keeps the same person twice when each occurrence is a different department', () => {
    const rows: ScannedRosterRow[] = [
      { n: 'Senae Gordon', s: '6:30', e: '10:30', d: 'Bakery' },
      { n: 'Senae Gordon', s: '10:30', e: '14:00', d: 'Deli' },
    ];
    const { entries, warnings } = parseRoster(rows);
    expect(entries).toHaveLength(2);
    expect(entries[0].department).toBe('Bakery');
    expect(entries[1].department).toBe('Deli');
    expect(warnings).toHaveLength(0);
  });

  it('still catches a genuine duplicate row within the same department', () => {
    const rows: ScannedRosterRow[] = [
      { n: 'Eli Benino', s: '10:00', e: '13:30', d: 'Checkouts' },
      { n: 'Eli Benino', s: '10:00', e: '13:30', d: 'Checkouts' },
    ];
    const { entries, warnings } = parseRoster(rows);
    expect(entries).toHaveLength(1);
    expect(warnings[0]).toMatch(/listed twice/);
  });

  it('treats entries with no department as their own group', () => {
    const rows: ScannedRosterRow[] = [{ n: 'Jane Doe', s: '9:00', e: '17:00' }];
    const { entries } = parseRoster(rows);
    expect(entries[0].department).toBeNull();
  });
});

describe('groupRosterEntries', () => {
  const entry = (name: string, department: string | null) => ({
    name, start_time: '09:00:00', end_time: '17:00:00', status: null, truncated: false, department,
  });

  it('produces one group per distinct department, in first-seen order', () => {
    const entries = [entry('A', 'Bakery'), entry('B', 'Deli'), entry('C', 'Bakery')];
    const groups = groupRosterEntries(entries, null);
    expect(groups.map(g => g.label)).toEqual(['Bakery', 'Deli']);
    expect(groups[0].entries.map(e => e.name)).toEqual(['A', 'C']);
    expect(groups[1].entries.map(e => e.name)).toEqual(['B']);
  });

  it('falls back to the document-level department when a row has none', () => {
    const entries = [entry('A', null)];
    const groups = groupRosterEntries(entries, 'Grocery');
    expect(groups).toEqual([{ label: 'Grocery', entries: [entries[0]] }]);
  });

  it('produces a single group for a single-department source', () => {
    const entries = [entry('A', 'Grocery'), entry('B', 'Grocery')];
    const groups = groupRosterEntries(entries, null);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries).toHaveLength(2);
  });
});
