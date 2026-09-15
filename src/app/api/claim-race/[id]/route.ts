import { NextRequest, NextResponse } from 'next/server';
import { getRaceDetail, cancelRace, RaceError } from '@/lib/raceService';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
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
