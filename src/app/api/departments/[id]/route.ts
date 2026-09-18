import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { name, requires_supervisor, color, is_default } = await req.json();

  // Only one department can be default — clear it off every other row first,
  // since the unique index would otherwise reject setting a second one.
  if (is_default === true) {
    await supabase.from('departments').update({ is_default: false }).neq('id', params.id).eq('is_default', true);
  }

  const updates: Record<string, unknown> = { name, requires_supervisor };
  if (color !== undefined) updates.color = color;
  if (is_default !== undefined) updates.is_default = is_default;

  const { data, error } = await supabase
    .from('departments')
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

  // Remove staff_departments references first
  await supabase.from('staff_departments').delete().eq('department_id', params.id);

  const { error } = await supabase.from('departments').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
