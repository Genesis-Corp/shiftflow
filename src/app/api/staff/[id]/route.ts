import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { toE164AU } from '@/lib/phone';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const { name, age_group, role_type, phone, active } = body;

  const { data, error } = await supabase
    .from('staff')
    .update({ name, age_group, role_type, phone, phone_e164: toE164AU(phone), active })
    .eq('id', params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  // Remove department assignments first
  await supabase.from('staff_departments').delete().eq('staff_id', params.id);

  const { error } = await supabase.from('staff').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
