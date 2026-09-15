import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { RosterEntry } from '@/lib/roster';
import { requireUser, unauthorized } from '@/lib/auth';
import { buildRosterPlan, applyRosterPlan, ExistingShift, RosterStaff } from '@/lib/rosterPlan';

/**
 * Turns roster entries read from a screenshot (or PDF) into shifts.
 *
 * Runs as a preview first: a name the app does not recognise, or someone
 * already rostered that day, is reported rather than quietly skipped, so the
 * source can be checked against the staff list before anything is written.
 *
 * A source read after the fact carries the day's outcome in its status chips.
 * A no-show there can be recorded against the person's reliability, but only
 * when the import explicitly asks for it — it lowers their score.
 *
 * The comparison/write logic lives in @/lib/rosterPlan so the automation
 * pipeline (/api/automation/roster-pdf) can run it per department without a
 * function export here — Next's route typing only allows HTTP-verb exports
 * (plus types) from a route.ts file.
 */

export type { RosterPlan } from '@/lib/rosterPlan';

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const date: string = body?.date ?? '';
  const departmentId: string = body?.department_id ?? '';
  const entries: RosterEntry[] = Array.isArray(body?.entries) ? body.entries : [];
  const mode: 'preview' | 'apply' = body?.mode === 'apply' ? 'apply' : 'preview';
  const logNoShows: boolean = body?.logNoShows === true;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Pick the date this roster is for.' }, { status: 400 });
  }
  if (!departmentId) {
    return NextResponse.json({ error: 'Pick which department this roster is for.' }, { status: 400 });
  }
  if (!entries.length) {
    return NextResponse.json({ error: 'No rostered people were supplied.' }, { status: 400 });
  }

  const [staffRes, shiftRes] = await Promise.all([
    supabase.from('staff').select('id, name, active'),
    supabase.from('shifts').select('id, assigned_staff_id, start_time, end_time, department_id').eq('date', date),
  ]);

  if (staffRes.error) {
    return NextResponse.json({ error: `Could not read the staff list: ${staffRes.error.message}` }, { status: 500 });
  }
  if (shiftRes.error) {
    return NextResponse.json({ error: `Could not read the existing shifts: ${shiftRes.error.message}` }, { status: 500 });
  }

  const staff = (staffRes.data ?? []) as RosterStaff[];
  const existing = (shiftRes.data ?? []) as ExistingShift[];

  const plan = buildRosterPlan(mode, date, departmentId, entries, staff, existing);

  if (mode === 'preview' || !plan.creates.length) {
    if (mode === 'apply') plan.applied = { shifts_created: 0, incidents_logged: 0 };
    return NextResponse.json(plan);
  }

  plan.applied = await applyRosterPlan(plan, departmentId, date, logNoShows);
  const insertFailed = plan.applied.shifts_created === 0 && plan.errors.length > 0;
  return NextResponse.json(plan, insertFailed ? { status: 500 } : undefined);
}
