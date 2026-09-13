import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { withNameParts } from '@/lib/staffNames';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const { name, age_group, role_type, phone, active } = body;

  // Keep first_name / last_name in step with a renamed staff member.
  const payload = await withNameParts({ name, age_group, role_type, phone, active }, name);

  const { data, error } = await supabase
    .from('staff')
    .update(payload)
    .eq('id', params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  // Remove department assignments and availability first
  await supabase.from('staff_departments').delete().eq('staff_id', params.id);
  await supabase.from('availability_templates').delete().eq('staff_id', params.id);

  const { error } = await supabase.from('staff').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
