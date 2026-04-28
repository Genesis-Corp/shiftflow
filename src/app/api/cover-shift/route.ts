import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { availabilityCoversShift, dayOfWeekFromDate } from '@/lib/shiftUtils';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { date, start_time, end_time, department_id, required_role } = body;

  if (!date || !start_time || !end_time || !department_id)
    return NextResponse.json({ error: 'date, start_time, end_time, department_id required' }, { status: 400 });

  // 1. Fetch department
  const { data: dept, error: deptErr } = await supabase
    .from('departments').select('*').eq('id', department_id).single();
  if (deptErr) return NextResponse.json({ error: deptErr.message }, { status: 500 });

  // 2. Fetch all active staff with departments
  const { data: allStaff, error: staffErr } = await supabase
    .from('staff')
    .select(`*, staff_departments ( department_id, training_level )`)
    .eq('active', true);
  if (staffErr) return NextResponse.json({ error: staffErr.message }, { status: 500 });

  // 3. Fetch availability templates: day-specific slots + all staff who have any availability set up
  const dayOfWeek = dayOfWeekFromDate(date);
  const [{ data: dayAvailability }, { data: allAvailability }] = await Promise.all([
    supabase.from('availability_templates').select('*').eq('day_of_week', dayOfWeek).eq('available', true),
    supabase.from('availability_templates').select('staff_id').eq('available', true),
  ]);

  // Staff who have ANY availability configured (used to distinguish "no data" vs "unavailable today")
  const staffWithAnyAvail = new Set(
    (allAvailability ?? []).map((a: { staff_id: string }) => a.staff_id)
  );

  const availMap = new Map<string, { start_time: string; end_time: string }[]>();
  (dayAvailability ?? []).forEach((a: { staff_id: string; start_time: string; end_time: string }) => {
    if (!availMap.has(a.staff_id)) availMap.set(a.staff_id, []);
    availMap.get(a.staff_id)!.push({ start_time: a.start_time, end_time: a.end_time });
  });

  // 4. Check if any seniors are available (for supervisor rule)
  const seniorAvailable = allStaff.some(s => s.age_group === 'senior');

  // 5. Filter eligible staff
  const eligible = allStaff.filter(s => {
    // Must be trained in requested department
    const deptIds = (s.staff_departments ?? []).map((d: { department_id: string }) => d.department_id);
    if (!deptIds.includes(department_id)) return false;

    // Supervisor rule: juniors can't cover supervisor-required dept if no senior on shift
    if (dept.requires_supervisor && s.age_group === 'junior' && !seniorAvailable) return false;

    // Role filter
    if (required_role && required_role !== 'any' && s.age_group !== required_role) return false;

    // Availability check
    const slots = availMap.get(s.id);
    if (slots && slots.length > 0) {
      return slots.some(slot => availabilityCoversShift(slot.start_time, slot.end_time, start_time, end_time));
    }
    // Has availability configured but not for this day → exclude
    if (staffWithAnyAvail.has(s.id)) return false;
    // No availability data at all → assume available (not set up yet)
    return true;
  });

  // 6. Score and rank
  const candidates = eligible.map(s => {
    let score = s.reliability_score ?? 50;

    if (dept.requires_supervisor && s.age_group === 'senior') score += 10;
    if (s.role_type === 'all_rounder') score += 5;
    if (s.role_type === 'potential_all_rounder') score += 2;
    if (s.role_type === 'department_only') score -= 2;

    // Bonus if they have a matching availability template
    if (availMap.has(s.id)) score += 3;

    const trainedDepts = s.staff_departments ?? [];
    return { ...s, computed_score: score, trained_departments: trainedDepts };
  }).sort((a, b) => b.computed_score - a.computed_score);

  return NextResponse.json({
    shift: { date, start_time, end_time, department_id, department: dept, required_role },
    eligible_count: eligible.length,
    candidates,
  });
}
