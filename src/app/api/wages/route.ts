import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * The award wage structure: the one adult base rate, the age brackets and
 * time-of-week loadings it's multiplied by, and the public holiday
 * calendar. Nobody's individual pay rate is stored — it's always computed
 * from their birthday, employment type and (for the 20-21 bracket)
 * commencement date, against this structure.
 */

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();

  const [baseRes, bracketsRes, loadingsRes, holidaysRes] = await Promise.all([
    supabase.from('wage_base_rate').select('*').eq('id', 'current').maybeSingle(),
    supabase.from('age_brackets').select('*').order('sort_order'),
    supabase.from('time_loadings').select('*'),
    supabase.from('public_holidays').select('*').order('date'),
  ]);

  if (baseRes.error) return NextResponse.json({ error: baseRes.error.message }, { status: 500 });
  if (bracketsRes.error) return NextResponse.json({ error: bracketsRes.error.message }, { status: 500 });
  if (loadingsRes.error) return NextResponse.json({ error: loadingsRes.error.message }, { status: 500 });
  if (holidaysRes.error) return NextResponse.json({ error: holidaysRes.error.message }, { status: 500 });

  return NextResponse.json({
    base_rate: baseRes.data,
    age_brackets: bracketsRes.data ?? [],
    time_loadings: loadingsRes.data ?? [],
    public_holidays: holidaysRes.data ?? [],
  });
}

/** Update the one number that changes each award cycle. */
export async function PUT(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const rate = Number(body?.adult_hourly_rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    return NextResponse.json({ error: 'adult_hourly_rate must be a positive number.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('wage_base_rate')
    .upsert([{ id: 'current', adult_hourly_rate: rate, updated_at: new Date().toISOString() }], { onConflict: 'id' })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}
