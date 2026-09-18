import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { toE164AU } from '@/lib/phone';
import { requireUser, unauthorized } from '@/lib/auth';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json();
  const { name, age_group, role_type, phone, active, birthday, employment_type, pay_rate } = body;

  const updates: Record<string, unknown> = { name, age_group, role_type, phone, phone_e164: toE164AU(phone), active };
  if (birthday !== undefined) updates.birthday = birthday || null;
  if (employment_type !== undefined) updates.employment_type = employment_type || null;
  if (pay_rate !== undefined) updates.pay_rate = pay_rate === '' || pay_rate === null ? null : pay_rate;

  const { data, error } = await supabase
    .from('staff')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return unauthorized();

  // Remove department assignments first
  await supabase.from('staff_departments').delete().eq('staff_id', params.id);

  const { error } = await supabase.from('staff').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
