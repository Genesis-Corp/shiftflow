import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { name, requires_supervisor } = await req.json();

  const { data, error } = await supabase
    .from('departments')
    .update({ name, requires_supervisor })
    .eq('id', params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  // Remove staff_departments references first
  await supabase.from('staff_departments').delete().eq('department_id', params.id);

  const { error } = await supabase.from('departments').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
