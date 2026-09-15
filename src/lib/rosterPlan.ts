import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { RosterEntry, matchStaffName } from '@/lib/roster';
import { requiresBreak, BREAK_DURATION_MINUTES, RELIABILITY_DELTAS, clampScore } from '@/lib/shiftUtils';

/**
 * Comparing roster entries against the staff list and existing shifts, and
 * writing the result — shared by the interactive import route
 * (/api/import-roster, one department at a time, previewed by a person
 * first) and the unattended automation pipeline (/api/automation/roster-pdf,
 * every department in one source, applied straight away).
 */

interface PlannedShift {
  name: string;
  staff_id: string;
  start_time: string;
  end_time: string;
  has_break: boolean;
  status: string | null;
}

export interface RosterPlan {
  mode: 'preview' | 'apply';
  date: string;
  creates: PlannedShift[];
  /** The same shift is already there — importing the same source twice is a no-op. */
  duplicates: { name: string; existing: string }[];
  /** How many shifts this department already has on this date. */
  existingOnDate: number;
  /** Names that do not match anyone on the staff list. */
  unmatched: string[];
  /** Read from the source but missing a usable time. */
  unreadable: string[];
  /** Rostered people the source marks as a no-show. */
  noShows: { name: string; staff_id: string }[];
  warnings: string[];
  errors: string[];
  applied?: { shifts_created: number; incidents_logged: number };
}

export interface ExistingShift {
  assigned_staff_id: string | null;
  start_time: string;
  end_time: string;
  department_id: string;
}

export interface RosterStaff {
  id: string;
  name: string;
  active: boolean;
}

/** Compare entries against the staff list and what's already on the date — no DB access. */
export function buildRosterPlan(
  mode: 'preview' | 'apply',
  date: string,
  departmentId: string,
  entries: RosterEntry[],
  staff: RosterStaff[],
  existing: ExistingShift[]
): RosterPlan {
  const plan: RosterPlan = {
    mode,
    date,
    creates: [],
    duplicates: [],
    existingOnDate: existing.filter(shift => shift.department_id === departmentId).length,
    unmatched: [],
    unreadable: [],
    noShows: [],
    warnings: [],
    errors: [],
  };

  /** Everything each person is already rostered for on this date. */
  const rostered = new Map<string, ExistingShift[]>();
  for (const shift of existing) {
    if (!shift.assigned_staff_id) continue;
    rostered.set(shift.assigned_staff_id, [...(rostered.get(shift.assigned_staff_id) ?? []), shift]);
  }

  const window = (shift: { start_time: string; end_time: string }) =>
    `${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)}`;

  for (const entry of entries) {
    if (!entry.start_time || !entry.end_time) {
      plan.unreadable.push(entry.name);
      continue;
    }

    const match = matchStaffName(entry, staff);
    if (!match) {
      plan.unmatched.push(entry.name);
      continue;
    }

    // The same person at the same start time is the same shift — that is what
    // makes re-importing a source harmless. A different time on the same day
    // is a second shift, which is allowed but worth pointing out, since it is
    // also what a roster imported against the wrong date looks like.
    const alreadyRostered = rostered.get(match.id) ?? [];
    const sameShift = alreadyRostered.find(shift => shift.start_time === entry.start_time);
    if (sameShift) {
      plan.duplicates.push({ name: match.name, existing: window(sameShift) });
      continue;
    }
    if (alreadyRostered.length) {
      plan.warnings.push(
        `${match.name} is already rostered ${alreadyRostered.map(window).join(' and ')} on this date — this adds ${window({ start_time: entry.start_time, end_time: entry.end_time })} as well.`
      );
    }

    if (!staff.find(s => s.id === match.id)?.active) {
      plan.warnings.push(`${match.name} is marked inactive but is on this roster.`);
    }

    // Only people getting a shift from this import can get an incident from it,
    // so re-importing the same source cannot log the same no-show twice.
    if (/no.?show/i.test(entry.status ?? '')) {
      plan.noShows.push({ name: match.name, staff_id: match.id });
    }

    plan.creates.push({
      name: match.name,
      staff_id: match.id,
      start_time: entry.start_time,
      end_time: entry.end_time,
      has_break: requiresBreak(entry.start_time.slice(0, 5), entry.end_time.slice(0, 5)),
      status: entry.status,
    });
  }

  return plan;
}

/** Write a previewed plan's creates (and, if asked, its no-shows) to the database. */
export async function applyRosterPlan(
  plan: RosterPlan,
  departmentId: string,
  date: string,
  logNoShows: boolean
): Promise<{ shifts_created: number; incidents_logged: number }> {
  if (!plan.creates.length) return { shifts_created: 0, incidents_logged: 0 };

  const { error } = await supabase.from('shifts').insert(
    plan.creates.map(shift => ({
      date,
      start_time: shift.start_time,
      end_time: shift.end_time,
      department_id: departmentId,
      required_role: 'any',
      status: 'covered',
      assigned_staff_id: shift.staff_id,
      has_break: shift.has_break,
      break_duration_minutes: shift.has_break ? BREAK_DURATION_MINUTES : 0,
      notes: 'Imported from roster',
    }))
  );

  if (error) {
    plan.errors.push(`Could not save the shifts: ${error.message}`);
    return { shifts_created: 0, incidents_logged: 0 };
  }

  await linkStaffToDepartment(plan.creates.map(c => c.staff_id), departmentId);

  const incidents = logNoShows ? await recordNoShows(plan, date) : 0;
  return { shifts_created: plan.creates.length, incidents_logged: incidents };
}

/**
 * A roster upload rosters someone into a department by giving them a shift
 * there — if they aren't already linked to that department, this is exactly
 * when they should be, the same "default to whichever department a roster
 * came off" rule the availability-sheet import already follows for staff
 * with none at all. Existing links (and their training_level) are left
 * untouched — this only fills in a missing one, never overwrites.
 */
async function linkStaffToDepartment(staffIds: string[], departmentId: string): Promise<void> {
  const uniqueIds = Array.from(new Set(staffIds));
  if (!uniqueIds.length) return;

  const { error } = await supabase.from('staff_departments').upsert(
    uniqueIds.map(staff_id => ({ staff_id, department_id: departmentId, training_level: 'trained' })),
    { onConflict: 'staff_id,department_id', ignoreDuplicates: true }
  );

  // A missed link doesn't invalidate the shift that was already written —
  // logged rather than surfaced as a plan error, same as the audit-log
  // pattern in sms/send.ts.
  if (error) console.error('[roster] failed to link staff to department:', error.message);
}

/** Log a no-show against each person the source marks as one, and dock their score. */
async function recordNoShows(plan: RosterPlan, date: string): Promise<number> {
  if (!plan.noShows.length) return 0;

  const { error } = await supabase.from('reliability_incidents').insert(
    plan.noShows.map(({ staff_id }) => ({
      staff_id,
      incident_type: 'no_show',
      date,
      notes: 'From roster import',
    }))
  );

  if (error) {
    plan.errors.push(`The shifts were added, but the no-shows could not be logged: ${error.message}`);
    return 0;
  }

  const delta = RELIABILITY_DELTAS.no_show ?? 0;
  const { data: scores } = await supabase
    .from('staff')
    .select('id, reliability_score')
    .in('id', plan.noShows.map(n => n.staff_id));

  for (const row of (scores ?? []) as { id: string; reliability_score: number }[]) {
    await supabase
      .from('staff')
      .update({ reliability_score: clampScore(row.reliability_score + delta) })
      .eq('id', row.id);
  }

  return plan.noShows.length;
}
