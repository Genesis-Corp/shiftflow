import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';
import { toE164AU } from '@/lib/phone';

/**
 * A manager's own name and mobile number — collected from them the first
 * time they sign in, not by whoever invited them. Supabase Auth's invite
 * flow only ever asks for a password.
 */

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { data, error } = await supabase.from('manager_profiles').select('*').eq('user_id', user.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? { user_id: user.id, name: null, phone: null, phone_e164: null });
}

export async function PUT(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const phoneRaw = typeof body?.phone === 'string' ? body.phone.trim() : '';
  if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });

  const phone_e164 = toE164AU(phoneRaw);
  if (!phone_e164) return NextResponse.json({ error: 'Enter a valid Australian mobile number.' }, { status: 400 });

  const { data, error } = await supabase
    .from('manager_profiles')
    .upsert([{ user_id: user.id, name, phone: phoneRaw, phone_e164, updated_at: new Date().toISOString() }], { onConflict: 'user_id' })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
