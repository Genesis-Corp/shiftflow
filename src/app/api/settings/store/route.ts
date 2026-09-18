import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';

/** Country/state the store operates in — drives the auto-generated public
 *  holiday calendar (see /api/wages/holidays/generate). */

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { data, error } = await supabase.from('store_settings').select('*').eq('id', 'current').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? { id: 'current', country: null, state: null });
}

export async function PUT(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const country = typeof body?.country === 'string' ? body.country.trim().toUpperCase() : null;
  const state = typeof body?.state === 'string' && body.state.trim() ? body.state.trim().toUpperCase() : null;
  if (!country) return NextResponse.json({ error: 'country is required.' }, { status: 400 });

  const { data, error } = await supabase
    .from('store_settings')
    .upsert([{ id: 'current', country, state, updated_at: new Date().toISOString() }], { onConflict: 'id' })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
