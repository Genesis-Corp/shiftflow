import { NextRequest, NextResponse } from 'next/server';
import { startRace, RaceError } from '@/lib/raceService';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { findEligibleCandidates } from '@/lib/eligibility';
import { splitContactable } from '@/lib/claimRace';
import { requireUser, unauthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** GET /api/claim-race?shift_id=… — preview who a race would contact. */
export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const shiftId = url.searchParams.get('shift_id');
  if (!shiftId) return NextResponse.json({ error: 'shift_id required' }, { status: 400 });
  const slotsNeededRaw = Number(url.searchParams.get('slots_needed'));
  const slotsNeeded = Number.isFinite(slotsNeededRaw) && slotsNeededRaw >= 1 ? Math.trunc(slotsNeededRaw) : 1;

  const { data: shift, error } = await supabaseAdmin
    .from('shifts').select(`*, departments ( id, name )`).eq('id', shiftId).single();
  if (error || !shift) return NextResponse.json({ error: 'Shift not found' }, { status: 404 });

  const { candidates, extendable, backup } = await findEligibleCandidates({
    date: shift.date,
    start_time: shift.start_time,
    end_time: shift.end_time,
    department_id: shift.department_id,
    required_role: shift.required_role,
    exclude_staff_id: shift.excluded_staff_id,
  });
  const { contactable, excluded } = splitContactable(candidates);

  const { data: active } = await supabaseAdmin
    .from('shift_claim_races').select('id')
    .eq('shift_id', shiftId).eq('status', 'active').maybeSingle();

  return NextResponse.json({
    shift,
    contactable: contactable.map(c => ({
      id: c.id, name: c.name, phone_e164: c.phone_e164,
      computed_score: c.computed_score, age_group: c.age_group,
    })),
    excluded,
    extendable,
    backup,
    active_race_id: active?.id ?? null,
    slots_needed: slotsNeeded,
  });
}

/** POST /api/claim-race { shift_id, force?, slots_needed? } — start the race. */
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { shift_id, force, slots_needed } = await req.json();
    if (!shift_id) return NextResponse.json({ error: 'shift_id required' }, { status: 400 });

    const result = await startRace(shift_id, { force: !!force, startedBy: user.id, slotsNeeded: slots_needed });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof RaceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
