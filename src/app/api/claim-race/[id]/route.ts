import { NextRequest, NextResponse } from 'next/server';
import { getRaceDetail, cancelRace, resolveDifferentTime, RaceError } from '@/lib/raceService';
import { requireUser, unauthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    return NextResponse.json(await getRaceDetail(params.id));
  } catch (err) {
    if (err instanceof RaceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}

/** DELETE — cancel a running race. Nobody is texted about the cancellation. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    await cancelRace(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RaceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}

/** PATCH { recipient_id, accept } — accept or decline a staff member's
 *  "different time" reply from the race panel (the same decision the
 *  manager can make by texting back the number, or NO + the number). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  if (typeof body?.recipient_id !== 'string' || typeof body?.accept !== 'boolean') {
    return NextResponse.json({ error: 'recipient_id and accept are required.' }, { status: 400 });
  }

  const result = await resolveDifferentTime(body.recipient_id, body.accept);
  if (!result.ok) {
    return NextResponse.json({ error: 'That reply has already been dealt with, or the shift is no longer open.' }, { status: 409 });
  }
  const detail = await getRaceDetail(params.id);
  return NextResponse.json(detail);
}
