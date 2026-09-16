import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Penalty loadings — when a higher rate applies, and how much higher. */

interface RuleInput {
  name: string;
  days: number[];
  start_time: string;
  end_time: string;
  multiplier: number;
  active: boolean;
}

/** Returns the cleaned rule, or a message saying what's wrong with it. */
function validate(body: unknown): RuleInput | string {
  const b = (body ?? {}) as Record<string, unknown>;

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) return 'Give the loading a name.';

  const days = Array.isArray(b.days) ? b.days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  if (days.length === 0) return 'Pick at least one day.';

  const time = /^\d{2}:\d{2}(:\d{2})?$/;
  const start_time = typeof b.start_time === 'string' ? b.start_time : '';
  const end_time = typeof b.end_time === 'string' ? b.end_time : '';
  if (!time.test(start_time) || !time.test(end_time)) return 'Start and end must be times.';

  const multiplier = Number(b.multiplier);
  if (!Number.isFinite(multiplier) || multiplier <= 0) return 'Multiplier must be greater than zero.';

  return {
    name, days, start_time, end_time, multiplier,
    active: b.active !== false,
  };
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const rule = validate(await req.json().catch(() => null));
  if (typeof rule === 'string') return NextResponse.json({ error: rule }, { status: 400 });

  const { data, error } = await supabase.from('penalty_rules').insert([rule]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });

  // Toggling active on its own shouldn't require resending the whole rule.
  if (Object.keys(body ?? {}).length === 2 && typeof body?.active === 'boolean') {
    const { error } = await supabase.from('penalty_rules').update({ active: body.active }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const rule = validate(body);
  if (typeof rule === 'string') return NextResponse.json({ error: rule }, { status: 400 });

  const { error } = await supabase.from('penalty_rules').update(rule).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });

  const { error } = await supabase.from('penalty_rules').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
