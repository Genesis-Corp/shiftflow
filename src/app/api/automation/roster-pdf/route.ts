import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireAutomationToken, automationUnauthorized } from '@/lib/auth';
import { readPdfRequest, visionErrorResponse } from '@/lib/vision';
import { readRosterPdf } from '@/lib/rosterVision';
import { groupRosterEntries, matchDepartment } from '@/lib/roster';
import { buildRosterPlan, applyRosterPlan, ExistingShift, RosterStaff } from '@/lib/rosterPlan';
import { AutomationFlag } from '@/lib/automationFlags';

/**
 * Unattended counterpart to /api/scan-roster + /api/import-roster: takes a
 * whole-store roster PDF (e.g. from the Humanforce scrape) for one date,
 * reads it, and applies every department it can match straight away — there
 * is no manager at a keyboard to preview it first.
 *
 * What a person would have caught in the preview step instead becomes a
 * flag: an unmatched department, an unmatched name, an unreadable time, a
 * warning, an insert error. Every run — clean or not — is recorded so the
 * app can show what happened, and the in-app banner surfaces any run that
 * still has open flags.
 *
 * Auth is a bearer token (AUTOMATION_TOKEN), not a manager session — the
 * caller is a script, not a browser.
 */

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!requireAutomationToken(req)) return automationUnauthorized();

  const body = await req.json().catch(() => null);
  const date = typeof body?.date === 'string' ? body.date : '';
  const logNoShows = body?.logNoShows !== false; // defaults on — the whole point is a hands-off run

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date is required, as YYYY-MM-DD.' }, { status: 400 });
  }

  const pdfRequest = readPdfRequest(body);
  if (pdfRequest instanceof NextResponse) return pdfRequest;

  let read;
  try {
    read = await readRosterPdf(pdfRequest);
  } catch (err) {
    return visionErrorResponse(err, 'PDF');
  }

  const flags: AutomationFlag[] = [];

  if (!read.entries.length) {
    flags.push({ department: null, kind: 'empty_read', message: 'No rostered people could be read from the PDF.' });
    const run = await recordRun(date, 0, 0, flags);
    return NextResponse.json({ date, departments_applied: 0, shifts_created: 0, flags, run_id: run });
  }

  const [deptRes, staffRes, shiftRes] = await Promise.all([
    supabase.from('departments').select('id, name'),
    supabase.from('staff').select('id, name, active'),
    supabase.from('shifts').select('id, assigned_staff_id, start_time, end_time, department_id').eq('date', date),
  ]);

  if (deptRes.error || staffRes.error || shiftRes.error) {
    flags.push({
      department: null,
      kind: 'error',
      message: `Could not read the department/staff/shift lists: ${(deptRes.error ?? staffRes.error ?? shiftRes.error)?.message}`,
    });
    const run = await recordRun(date, 0, 0, flags);
    return NextResponse.json({ date, departments_applied: 0, shifts_created: 0, flags, run_id: run }, { status: 500 });
  }

  const departments = deptRes.data as { id: string; name: string }[];
  const staff = staffRes.data as RosterStaff[];
  // Mutated as each department group is applied, so a later group's plan
  // sees shifts an earlier group in this same run just created — the same
  // person can legitimately be rostered in two departments the same day.
  let existing = shiftRes.data as ExistingShift[];

  const groups = groupRosterEntries(read.entries, read.department);

  let departmentsApplied = 0;
  let shiftsCreated = 0;

  for (const group of groups) {
    const label = group.label ?? '(no department given)';
    const department = matchDepartment(group.label ?? undefined, departments);

    if (!department) {
      flags.push({
        department: label,
        kind: 'unmatched_department',
        message: `"${label}" doesn't match any department in ShiftFlow — ${group.entries.length} shift(s) were skipped.`,
      });
      continue;
    }

    const plan = buildRosterPlan('apply', date, department.id, group.entries, staff, existing);
    plan.applied = await applyRosterPlan(plan, department.id, date, logNoShows);

    if (plan.applied.shifts_created > 0) {
      departmentsApplied += 1;
      shiftsCreated += plan.applied.shifts_created;
      existing = [
        ...existing,
        ...plan.creates.map(c => ({
          assigned_staff_id: c.staff_id, start_time: c.start_time, end_time: c.end_time, department_id: department.id,
        })),
      ];
    }

    for (const name of plan.unmatched) {
      flags.push({ department: department.name, kind: 'unmatched_staff', message: `${name} is not on the staff list.` });
    }
    for (const name of plan.unreadable) {
      flags.push({ department: department.name, kind: 'unreadable', message: `${name} — the rostered time could not be read.` });
    }
    for (const warning of plan.warnings) {
      flags.push({ department: department.name, kind: 'warning', message: warning });
    }
    for (const error of plan.errors) {
      flags.push({ department: department.name, kind: 'error', message: error });
    }
  }

  const runId = await recordRun(date, departmentsApplied, shiftsCreated, flags);
  return NextResponse.json({ date, departments_applied: departmentsApplied, shifts_created: shiftsCreated, flags, run_id: runId });
}

async function recordRun(
  roster_date: string, departments_applied: number, shifts_created: number, flags: AutomationFlag[]
): Promise<string | null> {
  const { data, error } = await supabase
    .from('automation_runs')
    .insert([{ roster_date, source: 'humanforce', departments_applied, shifts_created, flags }])
    .select('id')
    .single();

  // A run whose own bookkeeping row failed to save still did real work — that
  // is not a reason to fail the request or lose the flags already found.
  if (error) return null;
  return data?.id ?? null;
}
