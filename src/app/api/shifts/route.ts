import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import {
  requiresBreak, BREAK_DURATION_MINUTES, shiftDurationMinutes, MIN_SHIFT_MINUTES,
  minutesUntil, MIN_COVERABLE_MINUTES,
} from '@/lib/shiftUtils';
import { requireUser, unauthorized } from '@/lib/auth';
import { localDateNow, localTimeNow } from '@/lib/sms/config';

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  // Open shifts nobody ever covered used to sit around forever. Swept here,
  // on every read, rather than on a schedule — no cron needed, and it can
  // never go stale itself. Judged by time left until the shift ENDS, not
  // its start — a no-show shift is exactly the case where the start time
  // has already passed and it's still very much worth covering, so it
  // stays right up until there's under 3 hours of it left either way.
  const nowDate = localDateNow();
  const nowTime = localTimeNow();
  const { data: openShifts } = await supabase.from('shifts').select('id, date, end_time').eq('status', 'open');
  const staleIds = (openShifts ?? [])
    .filter((s: { date: string; end_time: string }) => minutesUntil(s.date, s.end_time, nowDate, nowTime) < MIN_COVERABLE_MINUTES)
    .map((s: { id: string }) => s.id);
  if (staleIds.length) await supabase.from('shifts').delete().in('id', staleIds);

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

  // A shift stays 'open' for its whole duration, including while a claim
  // race for it is running — so the client needs to know which ones already
  // have one, to stop a manager starting a second race on top of it.
  const shiftIds = (data ?? []).map((s: { id: string }) => s.id);
  const activeRaceByShift = new Map<string, string>();
  if (shiftIds.length) {
    const { data: activeRaces } = await supabase
      .from('shift_claim_races').select('id, shift_id').eq('status', 'active').in('shift_id', shiftIds);
    for (const r of (activeRaces ?? []) as { id: string; shift_id: string }[]) {
      activeRaceByShift.set(r.shift_id, r.id);
    }
  }

  const withRaceInfo = (data ?? []).map((s: { id: string }) => ({
    ...s, active_race_id: activeRaceByShift.get(s.id) ?? null,
  }));

  return NextResponse.json(withRaceInfo);
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
