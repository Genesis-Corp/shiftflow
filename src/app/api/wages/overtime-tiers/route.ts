import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';

/** Overtime rate tiers, per employment category — "1.5x for the first 3
 *  hours of overtime, then 2x after that" is two rows: tier_order 1 at
 *  hours_into_overtime 0, tier_order 2 at hours_into_overtime 3. */

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const employment_category = body?.employment_category;
  const hours_into_overtime = Number(body?.hours_into_overtime);
  const percentage = Number(body?.percentage);

  if (employment_category !== 'ft_pt' && employment_category !== 'casual') {
    return NextResponse.json({ error: 'employment_category must be ft_pt or casual.' }, { status: 400 });
  }
  if (!Number.isFinite(hours_into_overtime) || hours_into_overtime < 0) {
    return NextResponse.json({ error: 'hours_into_overtime must be 0 or more.' }, { status: 400 });
  }
  if (!Number.isFinite(percentage) || percentage <= 0) {
    return NextResponse.json({ error: 'percentage must be a positive number.' }, { status: 400 });
  }

  const { data: existing, error: existingErr } = await supabase
    .from('overtime_tiers')
    .select('tier_order')
    .eq('employment_category', employment_category)
    .order('tier_order', { ascending: false })
    .limit(1);
  if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });
  const nextOrder = (existing?.[0]?.tier_order ?? 0) + 1;

  const { data, error } = await supabase
    .from('overtime_tiers')
    .insert([{ employment_category, tier_order: nextOrder, hours_into_overtime, percentage }])
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });

  const { error } = await supabase.from('overtime_tiers').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
