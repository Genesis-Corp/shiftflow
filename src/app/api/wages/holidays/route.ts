import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';

/** The public holiday calendar — a shift on one of these dates is costed at
 *  the public-holiday rate regardless of what day of the week it falls on. */

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const date = typeof body?.date === 'string' ? body.date : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'A valid date is required.' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'Give the holiday a name.' }, { status: 400 });

  const { data, error } = await supabase.from('public_holidays').upsert([{ date, name }], { onConflict: 'date' }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const date = new URL(req.url).searchParams.get('date');
  if (!date) return NextResponse.json({ error: 'date is required.' }, { status: 400 });

  const { error } = await supabase.from('public_holidays').delete().eq('date', date);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
