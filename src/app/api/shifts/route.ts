import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requiresBreak, BREAK_DURATION_MINUTES, shiftDurationMinutes, MIN_SHIFT_MINUTES } from '@/lib/shiftUtils';
import { requireUser, unauthorized } from '@/lib/auth';
import { localDateNow } from '@/lib/sms/config';

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  // Open shifts nobody ever covered used to sit around forever. Swept here,
  // on every read, rather than on a schedule — no cron needed, and it can
  // never go stale itself. Only whole days already in the past: today's
  // shifts stay, however far into the day, so one still in progress (or
  // simply not yet covered) is never pulled out from under a manager mid-shift.
  await supabase.from('shifts').delete().eq('status', 'open').lt('date', localDateNow());

  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  const status = searchParams.get('status');

  let query = supabase
    .from('shifts')
    .select(`
      *,
      departments ( id, name, requires_supervisor, color ),
      assigned_staff:staff!assigned_staff_id ( id, name, age_group, role_type, birthday )
    `)
    .order('date')
    .order('start_time');

  if (date) query = query.eq('date', date);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json();
  const { date, start_time, end_time, department_id, required_role, notes } = body;

  if (!date || !start_time || !end_time || !department_id)
    return NextResponse.json({ error: 'date, start_time, end_time, department_id required' }, { status: 400 });

  if (shiftDurationMinutes(start_time, end_time) < MIN_SHIFT_MINUTES) {
    return NextResponse.json({ error: `Shifts must be at least ${MIN_SHIFT_MINUTES / 60} hours long.` }, { status: 400 });
  }

  const has_break = requiresBreak(start_time, end_time);

  const { data, error } = await supabase
    .from('shifts')
    .insert([{
      date, start_time, end_time, department_id,
      required_role: required_role ?? 'any',
      status: 'open',
      has_break,
      break_duration_minutes: has_break ? BREAK_DURATION_MINUTES : 0,
      notes: notes ?? null,
    }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
