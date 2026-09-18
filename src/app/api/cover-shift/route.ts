import { NextRequest, NextResponse } from 'next/server';
import { findEligibleCandidates } from '@/lib/eligibility';
import { requireUser, unauthorized } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

/**
 * Preview eligible staff for a shift.
 *
 * The scoring and filtering now live in @/lib/eligibility so that starting a
 * claim race recomputes the same list server-side rather than trusting
 * whatever the browser posts back.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json();
  const { date, start_time, end_time, department_id, required_role, shift_id } = body;

  if (!date || !start_time || !end_time || !department_id)
    return NextResponse.json({ error: 'date, start_time, end_time, department_id required' }, { status: 400 });

  try {
    let excludeStaffId: string | null = null;
    if (shift_id) {
      const { data: shiftRow } = await supabaseAdmin
        .from('shifts').select('excluded_staff_id').eq('id', shift_id).maybeSingle();
      excludeStaffId = shiftRow?.excluded_staff_id ?? null;
    }

    const { department, candidates, extendable, overlapExcluded, backup, fallback_pool } = await findEligibleCandidates({
      date, start_time, end_time, department_id, required_role, exclude_staff_id: excludeStaffId,
    });

    return NextResponse.json({
      shift: { id: shift_id ?? null, date, start_time, end_time, department_id, department, required_role },
      eligible_count: candidates.length,
      candidates,
      extendable,
      overlapExcluded,
      backup,
      fallback_pool,
      contactable_count: candidates.filter(c => c.phone_e164 && !c.sms_opt_out).length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
