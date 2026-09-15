import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';

/**
 * What the in-app banner reads: automation runs (currently just the
 * Humanforce roster pipeline) that still have open flags and haven't been
 * acknowledged by a manager yet.
 */

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { data, error } = await supabase
    .from('automation_runs')
    .select('*')
    .is('acknowledged_at', null)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/** Dismiss one run (or, with { all: true }, every currently-unacknowledged run). */
export async function PATCH(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : null;
  const all = body?.all === true;

  if (!id && !all) {
    return NextResponse.json({ error: 'Pass either id or all: true.' }, { status: 400 });
  }

  const query = supabase.from('automation_runs').update({ acknowledged_at: new Date().toISOString() });
  const { error } = id ? await query.eq('id', id) : await query.is('acknowledged_at', null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
