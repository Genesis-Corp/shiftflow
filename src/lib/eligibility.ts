import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { availabilityCoversShift, dayOfWeekFromDate } from '@/lib/shiftUtils';

/**
 * Shared eligibility + scoring.
 *
 * Extracted from the /api/cover-shift route so that starting a claim race
 * re-derives the candidate list on the server instead of trusting a list the
 * browser posts back. The browser decides nothing about who gets texted.
 */

export interface EligibilityQuery {
  date: string;
  start_time: string;
  end_time: string;
  department_id: string;
  required_role?: string | null;
}

export interface ScoredCandidate {
  id: string;
  name: string;
  age_group: 'junior' | 'senior';
  role_type: string;
  reliability_score: number;
  phone: string | null;
  phone_e164: string | null;
  sms_opt_out: boolean;
  computed_score: number;
  trained_departments: { department_id: string; training_level: string }[];
}

export interface EligibilityResult {
  department: { id: string; name: string; requires_supervisor: boolean };
  candidates: ScoredCandidate[];
}

export async function findEligibleCandidates(
  query: EligibilityQuery
): Promise<EligibilityResult> {
  const { date, start_time, end_time, department_id, required_role } = query;

  const { data: dept, error: deptErr } = await supabaseAdmin
    .from('departments').select('*').eq('id', department_id).single();
  if (deptErr) throw new Error(deptErr.message);

  const { data: allStaff, error: staffErr } = await supabaseAdmin
    .from('staff')
    .select(`*, staff_departments ( department_id, training_level )`)
    .eq('active', true);
  if (staffErr) throw new Error(staffErr.message);

  const dayOfWeek = dayOfWeekFromDate(date);
  const [{ data: dayAvailability }, { data: allAvailability }] = await Promise.all([
    supabaseAdmin.from('availability_templates').select('*')
      .eq('day_of_week', dayOfWeek).eq('available', true),
    supabaseAdmin.from('availability_templates').select('staff_id').eq('available', true),
  ]);

  const staffWithAnyAvail = new Set(
    (allAvailability ?? []).map((a: { staff_id: string }) => a.staff_id)
  );

  const availMap = new Map<string, { start_time: string; end_time: string }[]>();
  (dayAvailability ?? []).forEach((a: { staff_id: string; start_time: string; end_time: string }) => {
    if (!availMap.has(a.staff_id)) availMap.set(a.staff_id, []);
    availMap.get(a.staff_id)!.push({ start_time: a.start_time, end_time: a.end_time });
  });

  // NOTE: preserved verbatim from the original /api/cover-shift route — this
  // asks whether any senior exists on the roster at all, not whether one is
  // rostered on this shift. Changing it would change who gets texted, so it is
  // left alone here and flagged separately.
  const seniorAvailable = (allStaff ?? []).some(s => s.age_group === 'senior');

  const eligible = (allStaff ?? []).filter(s => {
    const deptIds = (s.staff_departments ?? []).map((d: { department_id: string }) => d.department_id);
    if (!deptIds.includes(department_id)) return false;

    if (dept.requires_supervisor && s.age_group === 'junior' && !seniorAvailable) return false;

    if (required_role && required_role !== 'any' && s.age_group !== required_role) return false;

    const slots = availMap.get(s.id);
    if (slots && slots.length > 0) {
      return slots.some(slot =>
        availabilityCoversShift(slot.start_time, slot.end_time, start_time, end_time));
    }
    if (staffWithAnyAvail.has(s.id)) return false;
    return true;
  });

  const candidates: ScoredCandidate[] = eligible.map(s => {
    let score = s.reliability_score ?? 50;
    if (dept.requires_supervisor && s.age_group === 'senior') score += 10;
    if (s.role_type === 'all_rounder') score += 5;
    if (s.role_type === 'potential_all_rounder') score += 2;
    if (s.role_type === 'department_only') score -= 2;
    if (availMap.has(s.id)) score += 3;

    return {
      id: s.id,
      name: s.name,
      age_group: s.age_group,
      role_type: s.role_type,
      reliability_score: s.reliability_score ?? 50,
      phone: s.phone ?? null,
      phone_e164: s.phone_e164 ?? null,
      sms_opt_out: s.sms_opt_out ?? false,
      computed_score: score,
      trained_departments: s.staff_departments ?? [],
    };
  }).sort((a, b) => b.computed_score - a.computed_score);

  return { department: dept, candidates };
}
