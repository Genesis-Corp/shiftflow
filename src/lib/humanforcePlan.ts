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

/** Conservative additions only. Changed, missing and ambiguous records are review items. */
export function planHumanforceSync(entries: SyncEntry[], staff: { id: string; name: string; active: boolean }[],
  departments: { id: string; name: string }[], existing: SyncShift[]) {
  const creates: SyncCreate[] = [], flags: AutomationFlag[] = [];
  const matched = new Set<string>(), scopedDepartments = new Set<string>();
  let duplicates = 0;
  const flag = (department: string | null, kind: AutomationFlag['kind'], message: string) => flags.push({ department, kind, message });
  const deptKey = (s: string) => nameKey(s).replace(/s$/, '');
  const usable = entries.filter(e => !excludedArea(e.department ?? ''));
  for (const entry of usable) {
    const depts = departments.filter(d => deptKey(d.name) === deptKey(entry.department ?? ''));
    if (depts.length !== 1) { flag(entry.department, 'unmatched_department', 'Department has no unique exact match; skipped.'); continue; }
    const dept = depts[0];
    scopedDepartments.add(dept.id);
    const people = staff.filter(s => nameKey(s.name) === nameKey(entry.name));
    if (people.length !== 1 || entry.truncated) { flag(dept.name, 'unmatched_staff', `${entry.name}: no unique full-name match; skipped.`); continue; }
    const person = people[0];
    if (!person.active) { flag(dept.name, 'warning', `${person.name}: inactive staff member; skipped.`); continue; }
    if (!entry.start_time || !entry.end_time || !/^([01]\d|2[0-3]):[0-5]\d:00$/.test(entry.start_time) || !/^([01]\d|2[0-3]):[0-5]\d:00$/.test(entry.end_time) || entry.start_time === entry.end_time) {
      flag(dept.name, 'unreadable', `${person.name}: invalid shift times; skipped.`); continue;
    }
    if (usable.filter(e => nameKey(e.name) === nameKey(entry.name)).length > 1) {
      flag(dept.name, 'warning', `${person.name}: multiple source rows on this day require review; skipped.`); continue;
    }
    const same = existing.filter(s => s.assigned_staff_id === person.id);
    const exact = same.find(s => s.department_id === dept.id && s.status === 'covered' &&
      s.start_time.slice(0, 5) === entry.start_time!.slice(0, 5) && s.end_time.slice(0, 5) === entry.end_time!.slice(0, 5) &&
      (entry.has_break === undefined || (s.has_break === entry.has_break && s.break_duration_minutes === entry.break_duration_minutes)));
    if (exact) { matched.add(exact.id); duplicates++; continue; }
    if (same.length) { flag(dept.name, 'warning', `${person.name}: roster differs from existing shift(s); kept existing shifts for review.`); continue; }
    if (existing.some(s => s.department_id === dept.id && !s.assigned_staff_id)) {
      flag(dept.name, 'warning', `${person.name}: department has an unassigned shift; review before adding.`); continue;
    }
    // The PDF reader does not supply break segments. Do not invent break details.
    if (entry.has_break === undefined) { flag(dept.name, 'warning', `${person.name}: PDF cannot verify break segments; review before adding.`); continue; }
    creates.push({ staff_id: person.id, department_id: dept.id, start_time: entry.start_time, end_time: entry.end_time,
      has_break: entry.has_break, break_duration_minutes: entry.break_duration_minutes ?? 0 });
  }
  for (const shift of existing) {
    if (!scopedDepartments.has(shift.department_id) || matched.has(shift.id)) continue;
    flag(departments.find(d => d.id === shift.department_id)?.name ?? null, 'warning',
      `Existing shift ${shift.id} (${shift.start_time.slice(0,5)}–${shift.end_time.slice(0,5)}) was not confirmed by this report; retained for review.`);
  }
  return { creates, flags, duplicates };
}
