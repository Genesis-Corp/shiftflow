import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Wage rates and the penalty loadings applied on top of them, for the wage
 * table on the Managers page and for costing a shift in the Cover Shift flow.
 */

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();

  const [staffRes, rulesRes] = await Promise.all([
    supabase
      .from('staff')
      .select('id, name, age_group, active, staff_wages ( base_hourly_rate, updated_at )')
      .order('name'),
    supabase.from('penalty_rules').select('*').order('multiplier', { ascending: false }),
  ]);

  if (staffRes.error) return NextResponse.json({ error: staffRes.error.message }, { status: 500 });
  if (rulesRes.error) return NextResponse.json({ error: rulesRes.error.message }, { status: 500 });

  type WageJoin = { base_hourly_rate: number; updated_at: string };
  const staff = (staffRes.data ?? []).map(s => {
    // PostgREST returns a one-to-one embed as an object or a single-element
    // array depending on how it infers the relationship — handle both.
    const joined = s.staff_wages as WageJoin | WageJoin[] | null;
    const wage = Array.isArray(joined) ? joined[0] : joined;
    return {
      id: s.id,
      name: s.name,
      age_group: s.age_group,
      active: s.active,
      base_hourly_rate: wage?.base_hourly_rate ?? null,
      updated_at: wage?.updated_at ?? null,
    };
  });

  return NextResponse.json({ staff, rules: rulesRes.data ?? [] });
}

/** Apply a batch of rates at once — what the wage-sheet scan hands back. */
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const rows = Array.isArray(body?.rates) ? body.rates : [];

  const clean: { staff_id: string; base_hourly_rate: number; updated_at: string }[] = [];
  for (const row of rows) {
    const staffId = typeof row?.staff_id === 'string' ? row.staff_id : '';
    const rate = Number(row?.base_hourly_rate);
    if (!staffId || !Number.isFinite(rate) || rate < 0) continue;
    clean.push({ staff_id: staffId, base_hourly_rate: rate, updated_at: new Date().toISOString() });
  }

  if (!clean.length) return NextResponse.json({ error: 'No usable rates were supplied.' }, { status: 400 });

  const { error } = await supabase.from('staff_wages').upsert(clean, { onConflict: 'staff_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, applied: clean.length });
}

/** Set (or clear) one person's hourly rate. */
export async function PUT(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const staffId = typeof body?.staff_id === 'string' ? body.staff_id : '';
  const raw = body?.base_hourly_rate;

  if (!staffId) return NextResponse.json({ error: 'staff_id is required.' }, { status: 400 });

  // An empty rate means "not set" rather than zero — a $0 rate would quietly
  // make someone look like the cheapest person for every shift.
  if (raw === null || raw === '') {
    const { error } = await supabase.from('staff_wages').delete().eq('staff_id', staffId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, base_hourly_rate: null });
  }

  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate < 0) {
    return NextResponse.json({ error: 'Rate must be a number of dollars per hour.' }, { status: 400 });
  }

  const { error } = await supabase
    .from('staff_wages')
    .upsert([{ staff_id: staffId, base_hourly_rate: rate, updated_at: new Date().toISOString() }],
      { onConflict: 'staff_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, base_hourly_rate: rate });
}
