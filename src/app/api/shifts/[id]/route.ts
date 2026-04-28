import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requiresBreak, BREAK_DURATION_MINUTES } from '@/lib/shiftUtils';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const { start_time, end_time, department_id, required_role, status, assigned_staff_id, notes } = body;

  const updates: Record<string, unknown> = {};
  if (start_time !== undefined) updates.start_time = start_time;
  if (end_time !== undefined) updates.end_time = end_time;
  if (department_id !== undefined) updates.department_id = department_id;
  if (required_role !== undefined) updates.required_role = required_role;
  if (status !== undefined) updates.status = status;
  if (assigned_staff_id !== undefined) updates.assigned_staff_id = assigned_staff_id;
  if (notes !== undefined) updates.notes = notes;

  // Recalculate break if times changed
  if (start_time || end_time) {
    const { data: existing } = await supabase.from('shifts').select('start_time,end_time').eq('id', params.id).single();
    const s = start_time ?? existing?.start_time;
    const e = end_time ?? existing?.end_time;
    if (s && e) {
      updates.has_break = requiresBreak(s, e);
      updates.break_duration_minutes = updates.has_break ? BREAK_DURATION_MINUTES : 0;
    }
  }

  const { data, error } = await supabase
    .from('shifts')
    .update(updates)
    .eq('id', params.id)
    .select(`*, departments ( id, name, requires_supervisor )`)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await supabase.from('shifts').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
