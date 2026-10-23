import type { RosterEntry } from './roster';
import type { AutomationFlag } from './automationFlags';
import { nameKey } from './availabilitySheet';
import { excludedArea } from './humanforceCsv.mjs';

export type SyncEntry = RosterEntry & { has_break?: boolean; break_duration_minutes?: number };
export type SyncShift = {
  id: string; assigned_staff_id: string | null; department_id: string;
  start_time: string; end_time: string; has_break: boolean; break_duration_minutes: number; status: string;
};
export type SyncCreate = {
  staff_id: string; department_id: string; start_time: string; end_time: string;
  has_break: boolean; break_duration_minutes: number;
};

/** A complete validated CSV is authoritative for its date. Any flag blocks the whole day. */
export function planHumanforceSync(entries: SyncEntry[], staff: { id: string; name: string; active: boolean }[],
  departments: { id: string; name: string }[], existing: SyncShift[]) {
  const desired: SyncCreate[] = [], flags: AutomationFlag[] = [];
  const flag = (department: string | null, kind: AutomationFlag['kind'], message: string) => flags.push({ department, kind, message });
  const deptKey = (s: string) => {
    const key = nameKey(s).replace(/s$/, '');
    // Humanforce calls this Grocery; the existing ShiftFlow department was
    // named Grocery Assistant. Still require exactly one matching department.
    return key === 'grocery assistant' ? 'grocery' : key;
  };
  const scope = new Set(departments.filter(d => !excludedArea(d.name)).map(d => d.id));
  for (const entry of entries.filter(e => !excludedArea(e.department ?? ''))) {
    const depts = departments.filter(d => deptKey(d.name) === deptKey(entry.department ?? ''));
    if (depts.length !== 1) { flag(entry.department, 'unmatched_department', 'Department has no unique exact match; replacement blocked for this day.'); continue; }
    const dept = depts[0];
    const people = staff.filter(s => nameKey(s.name) === nameKey(entry.name));
    if (people.length !== 1 || entry.truncated) { flag(dept.name, 'unmatched_staff', `${entry.name}: no unique full-name match; replacement blocked.`); continue; }
    const person = people[0];
    if (!person.active) { flag(dept.name, 'warning', `${person.name}: inactive staff member; replacement blocked.`); continue; }
    if (!entry.start_time || !entry.end_time || !/^([01]\d|2[0-3]):[0-5]\d:00$/.test(entry.start_time) || !/^([01]\d|2[0-3]):[0-5]\d:00$/.test(entry.end_time) || entry.start_time === entry.end_time) {
      flag(dept.name, 'unreadable', `${person.name}: invalid shift times; replacement blocked.`); continue;
    }
    const minutes = (s: string) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
    const start = minutes(entry.start_time), end = minutes(entry.end_time) + (entry.end_time < entry.start_time ? 1440 : 0);
    if (end - start > 960 || !Number.isInteger(entry.break_duration_minutes) || entry.break_duration_minutes! < 0 || entry.break_duration_minutes! > 60 || entry.has_break !== (entry.break_duration_minutes! > 0)) {
      flag(dept.name, 'warning', `${person.name}: CSV break segments could not be verified; replacement blocked.`); continue;
    }
    if (desired.some(s => {
      const otherStart = minutes(s.start_time), otherEnd = minutes(s.end_time) + (s.end_time < s.start_time ? 1440 : 0);
      return s.staff_id === person.id && start < otherEnd && otherStart < end;
    })) { flag(dept.name, 'warning', `${person.name}: overlapping source assignments; replacement blocked.`); continue; }
    desired.push({ staff_id: person.id, department_id: dept.id, start_time: entry.start_time, end_time: entry.end_time,
      has_break: entry.has_break!, break_duration_minutes: entry.break_duration_minutes! });
  }
  if (!desired.length && !flags.length) flag(null, 'empty_read', 'No in-scope assignments; replacement blocked.');
  // Keep identical rows and IDs. All other in-scope rows on this date go.
  const keep = new Set<string>();
  const creates = desired.filter(entry => {
    const exact = existing.find(s => !keep.has(s.id) && s.assigned_staff_id === entry.staff_id &&
      s.department_id === entry.department_id && s.status === 'covered' &&
      s.start_time.slice(0, 5) === entry.start_time.slice(0, 5) && s.end_time.slice(0, 5) === entry.end_time.slice(0, 5) &&
      s.has_break === entry.has_break && s.break_duration_minutes === entry.break_duration_minutes);
    if (!exact) return true;
    keep.add(exact.id); return false;
  });
  const removeIds = existing.filter(s => scope.has(s.department_id) && !keep.has(s.id)).map(s => s.id);
  return { desired, creates, removeIds, flags, duplicates: keep.size, canApply: flags.length === 0 };
}
