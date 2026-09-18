import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requiresBreak, BREAK_DURATION_MINUTES, shiftDurationMinutes, MIN_SHIFT_MINUTES } from '@/lib/shiftUtils';
import { requireUser, unauthorized } from '@/lib/auth';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json();
  const { start_time, end_time, department_id, required_role, status, assigned_staff_id, excluded_staff_id, notes } = body;

  const updates: Record<string, unknown> = {};
  if (start_time !== undefined) updates.start_time = start_time;
  if (end_time !== undefined) updates.end_time = end_time;
  if (department_id !== undefined) updates.department_id = department_id;
  if (required_role !== undefined) updates.required_role = required_role;
  if (status !== undefined) updates.status = status;
  if (assigned_staff_id !== undefined) updates.assigned_staff_id = assigned_staff_id;
  if (notes !== undefined) updates.notes = notes;

  if (excluded_staff_id !== undefined) {
    updates.excluded_staff_id = excluded_staff_id;
  } else if (assigned_staff_id) {
    // A real assignment supersedes any earlier exclusion on this shift row —
    // otherwise whoever called in sick last time would stay locked out of a
    // later, unrelated reopening of the same shift.
    updates.excluded_staff_id = null;
  }

  // Recalculate break if times changed, and re-check the minimum length
  // against the resulting times, not just whichever one was actually sent.
  if (start_time || end_time) {
    const { data: existing } = await supabase.from('shifts').select('start_time,end_time').eq('id', params.id).single();
    const s = start_time ?? existing?.start_time;
    const e = end_time ?? existing?.end_time;
    if (s && e) {
      if (shiftDurationMinutes(s, e) < MIN_SHIFT_MINUTES) {
        return NextResponse.json({ error: `Shifts must be at least ${MIN_SHIFT_MINUTES / 60} hours long.` }, { status: 400 });
      }
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
  const user = await requireUser();
  if (!user) return unauthorized();

  const { error } = await supabase.from('shifts').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
