import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { RosterEntry, matchStaffName } from '@/lib/roster';
import { requiresBreak, BREAK_DURATION_MINUTES } from '@/lib/shiftUtils';

/**
 * Turns roster entries read from a screenshot into shifts.
 *
 * Runs as a preview first: a name the app does not recognise, or someone
 * already rostered that day, is reported rather than quietly skipped, so the
 * screenshot can be checked against the staff list before anything is written.
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
  /** Already rostered that day — importing the same screenshot twice is a no-op. */
  duplicates: { name: string; existing: string }[];
  /** Names that do not match anyone on the staff list. */
  unmatched: string[];
  /** Read from the screenshot but missing a usable time. */
  unreadable: string[];
  warnings: string[];
  errors: string[];
  applied?: { shifts_created: number };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const date: string = body?.date ?? '';
  const departmentId: string = body?.department_id ?? '';
  const entries: RosterEntry[] = Array.isArray(body?.entries) ? body.entries : [];
  const mode: 'preview' | 'apply' = body?.mode === 'apply' ? 'apply' : 'preview';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Pick the date this roster is for.' }, { status: 400 });
  }
  if (!departmentId) {
    return NextResponse.json({ error: 'Pick which department this roster is for.' }, { status: 400 });
  }
  if (!entries.length) {
    return NextResponse.json({ error: 'No rostered people were supplied.' }, { status: 400 });
  }

  const plan: RosterPlan = {
    mode,
    date,
    creates: [],
    duplicates: [],
    unmatched: [],
    unreadable: [],
    warnings: [],
    errors: [],
  };

  const [staffRes, shiftRes] = await Promise.all([
    supabase.from('staff').select('id, name, active'),
    supabase.from('shifts').select('id, assigned_staff_id, start_time, end_time').eq('date', date),
  ]);

  if (staffRes.error) {
    plan.errors.push(`Could not read the staff list: ${staffRes.error.message}`);
    return NextResponse.json(plan, { status: 500 });
  }
  if (shiftRes.error) {
    plan.errors.push(`Could not read the existing shifts: ${shiftRes.error.message}`);
    return NextResponse.json(plan, { status: 500 });
  }

  const staff = (staffRes.data ?? []) as { id: string; name: string; active: boolean }[];
  const rostered = new Map<string, string>();
  for (const shift of (shiftRes.data ?? []) as { assigned_staff_id: string | null; start_time: string; end_time: string }[]) {
    if (shift.assigned_staff_id) {
      rostered.set(shift.assigned_staff_id, `${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)}`);
    }
  }

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

    const existing = rostered.get(match.id);
    if (existing) {
      plan.duplicates.push({ name: match.name, existing });
      continue;
    }

    if (!staff.find(s => s.id === match.id)?.active) {
      plan.warnings.push(`${match.name} is marked inactive but is on this roster.`);
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

  if (mode === 'preview' || !plan.creates.length) {
    if (mode === 'apply') plan.applied = { shifts_created: 0 };
    return NextResponse.json(plan);
  }

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
    plan.applied = { shifts_created: 0 };
    return NextResponse.json(plan, { status: 500 });
  }

  plan.applied = { shifts_created: plan.creates.length };
  return NextResponse.json(plan);
}
