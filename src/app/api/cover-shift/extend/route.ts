import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/auth';
import { requestExtension, ExtendError } from '@/lib/extendService';

/**
 * Extend a staff member's existing overlapping shift to cover an open one,
 * instead of double-booking them or running a claim race they were already
 * excluded from.
 *
 * Extending LATER (their shift stays open past its rostered end) applies
 * immediately — the manager can just tell them, they're already on shift.
 * Extending EARLIER (their new start is before their rostered start) asks
 * them by SMS first, since they aren't at the store to ask; the response
 * here is `{ pending: true }` rather than the updated shift in that case.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const shiftId = typeof body?.shift_id === 'string' ? body.shift_id : '';
  const staffId = typeof body?.staff_id === 'string' ? body.staff_id : '';

  if (!shiftId || !staffId) {
    return NextResponse.json({ error: 'shift_id and staff_id are required.' }, { status: 400 });
  }

  try {
    const outcome = await requestExtension(shiftId, staffId, user.id);
    if (outcome.applied) return NextResponse.json({ applied: true, shift: outcome.shift });
    return NextResponse.json({ applied: false, pending: true, requestId: outcome.requestId }, { status: 202 });
  } catch (err) {
    if (err instanceof ExtendError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
