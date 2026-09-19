import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';
import {
  shiftsOverlap, mergeShiftRanges, shiftDurationMinutes, requiresBreak, clashesWithOtherShift,
  BREAK_DURATION_MINUTES, MAX_EXTENDED_SHIFT_MINUTES,
} from '@/lib/shiftUtils';

/**
 * Extend a staff member's existing overlapping shift to cover an open one,
 * instead of double-booking them or running a claim race they were already
 * excluded from.
 *
 * Everything is re-derived from the two IDs rather than trusting times the
 * browser posts back — the same "browser decides nothing" rule the claim
 * race itself follows — so a stale preview (someone else edited a shift
 * in between) can't produce a bad write.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const shiftId = typeof body?.shift_id === 'string' ? body.shift_id : '';
  const staffId = typeof body?.staff_id === 'string' ? body.staff_id : '';

  if (!shiftId || !staffId) {
    return NextResponse.json({ error: 'shift_id and staff_id are required.' }, { status: 400 });
  }

  const { data: openShift, error: openErr } = await supabase
    .from('shifts').select('*').eq('id', shiftId).single();
  if (openErr || !openShift) {
    return NextResponse.json({ error: 'Shift not found.' }, { status: 404 });
  }
  if (openShift.status !== 'open') {
    return NextResponse.json({ error: 'This shift is no longer open.' }, { status: 409 });
  }

  const { data: sameDayShifts, error: sameDayErr } = await supabase
    .from('shifts')
    .select('*')
    .eq('assigned_staff_id', staffId)
    .eq('date', openShift.date)
    .eq('status', 'covered');
  if (sameDayErr) {
    return NextResponse.json({ error: `Could not read their existing shifts: ${sameDayErr.message}` }, { status: 500 });
  }

  const overlapping = (sameDayShifts ?? []).filter(s =>
    shiftsOverlap(s.start_time, s.end_time, openShift.start_time, openShift.end_time)
  );

  if (overlapping.length === 0) {
    return NextResponse.json(
      { error: 'No overlapping shift found for this staff member — nothing to extend.' }, { status: 409 }
    );
  }
  if (overlapping.length > 1) {
    return NextResponse.json(
      { error: 'This person has more than one overlapping shift that day — resolve it manually on the Shifts page.' },
      { status: 409 }
    );
  }

  const existing = overlapping[0];
  const merged = mergeShiftRanges(existing.start_time, existing.end_time, openShift.start_time, openShift.end_time);

  // A split shift — another shift they already have the same day that
  // doesn't itself overlap the open one — can still rule this out if
  // stretching to the merged range would reach into it.
  const otherSameDayShifts = (sameDayShifts ?? []).filter(s => s.id !== existing.id);
  if (clashesWithOtherShift(merged.start_time, merged.end_time, otherSameDayShifts)) {
    return NextResponse.json(
      { error: `Extending to ${merged.start_time}–${merged.end_time} would overlap another shift they already have that day.` },
      { status: 409 }
    );
  }

  if (shiftDurationMinutes(merged.start_time, merged.end_time) > MAX_EXTENDED_SHIFT_MINUTES) {
    return NextResponse.json(
      { error: `Extending to ${merged.start_time}–${merged.end_time} would exceed the ${MAX_EXTENDED_SHIFT_MINUTES / 60}-hour maximum shift length.` },
      { status: 409 }
    );
  }

  const hasBreak = requiresBreak(merged.start_time, merged.end_time);

  const { data: updated, error: updateErr } = await supabase
    .from('shifts')
    .update({
      start_time: merged.start_time,
      end_time: merged.end_time,
      has_break: hasBreak,
      break_duration_minutes: hasBreak ? BREAK_DURATION_MINUTES : 0,
      notes: existing.notes ? `${existing.notes} (extended to cover an open shift)` : 'Extended to cover an open shift',
    })
    .eq('id', existing.id)
    .select()
    .single();

  if (updateErr) {
    return NextResponse.json({ error: `Could not extend the shift: ${updateErr.message}` }, { status: 500 });
  }

  // The open shift's coverage is now folded into the extended one — leaving
  // it around would double-count hours and show as a second, unfilled shift.
  const { error: deleteErr } = await supabase.from('shifts').delete().eq('id', shiftId);
  if (deleteErr) {
    return NextResponse.json({
      shift: updated,
      warning: `The shift was extended, but the original open shift could not be removed: ${deleteErr.message}`,
    });
  }

  return NextResponse.json({ shift: updated });
}
