import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  availabilityCoversShift, dayOfWeekFromDate, weekBounds, shiftsOverlap, mergeShiftRanges,
  shiftDurationMinutes, requiresBreak, BREAK_DURATION_MINUTES,
  MAX_EXTENDED_SHIFT_MINUTES, WEEKLY_HOURS_CAP_MINUTES, isBirthday,
} from '@/lib/shiftUtils';
import {
  calculateShiftCost, ageBracketFor, seniorityFromBirthday,
  AgeBracket, TimeLoading, EmploymentCategory, OvertimeTier, OvertimeOverride,
} from '@/lib/wages';
import { rankCandidates } from '@/lib/coverTiers';

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
  /** Someone who was just reopened out of this exact shift (a sick call) —
   *  never eligible for it again until it's assigned to someone for real. */
  exclude_staff_id?: string | null;
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
  /** Minutes already rostered this Sun–Sat week, before this shift. */
  weekly_minutes_before: number;
  /** weekly_minutes_before plus this shift — what taking it would bring them to. */
  weekly_minutes_after: number;
  /** What this shift would cost with them on it, or null if they have no rate set. */
  shift_cost: number | null;
  /** Why shift_cost is null — surfaced so "no rate" reads as a data gap to
   *  fix, not a mystery. Null when shift_cost itself isn't null. */
  cost_reason: 'no_base_rate' | 'salary' | 'no_birthday' | null;
}

/** Someone whose existing shift overlaps this one closely enough to extend instead of double-booking. */
export interface ExtendableCandidate {
  id: string;
  name: string;
  phone: string | null;
  phone_e164: string | null;
  existing_shift: { id: string; start_time: string; end_time: string };
  /** The merged range extending their existing shift would produce. */
  proposed: { start_time: string; end_time: string };
}

/** Someone whose existing shift overlaps this one, but merging them would run over the 10h cap. */
export interface OverlapConflict {
  id: string;
  name: string;
  existing_shift: { start_time: string; end_time: string };
}

export interface EligibilityResult {
  department: { id: string; name: string; requires_supervisor: boolean };
  /** Race-eligible: no scheduling conflict, no weekly-hours breach. */
  candidates: ScoredCandidate[];
  /** Excluded from the race — already rostered overlapping this time, but extending that shift would cover it within the 10h cap. */
  extendable: ExtendableCandidate[];
  /** Excluded from the race — already rostered overlapping this time, and extending would exceed the 10h cap. */
  overlapExcluded: OverlapConflict[];
  /** Excluded from the race — taking this shift would exceed 38 weekly hours. Shown as a backup option, not raced. */
  backup: ScoredCandidate[];
  /** Set when nobody trained in the shift's own department was eligible and
   *  the pool was widened to Checkout staff instead — juniors first, then
   *  seniors too if no juniors were available either. */
  fallback_pool: 'checkout_junior' | 'checkout_senior' | null;
}

export async function findEligibleCandidates(
  query: EligibilityQuery
): Promise<EligibilityResult> {
  const { date, start_time, end_time, department_id, required_role, exclude_staff_id } = query;

  const [{ data: dept, error: deptErr }, { data: checkoutDept }] = await Promise.all([
    supabaseAdmin.from('departments').select('*').eq('id', department_id).single(),
    // Fetched up front, used only if the shift's own department turns out
    // to have nobody eligible at all — cheap enough not to bother gating it
    // behind that check first.
    supabaseAdmin.from('departments').select('id, name').ilike('name', '%checkout%').limit(1).maybeSingle(),
  ]);
  if (deptErr) throw new Error(deptErr.message);

  const { data: allStaff, error: staffErr } = await supabaseAdmin
    .from('staff')
    .select(`*, staff_departments ( department_id, training_level )`)
    .eq('active', true)
    .eq('archived', false);
  if (staffErr) throw new Error(staffErr.message);

  // The stored age_group column goes stale the moment someone has a
  // birthday — a 17-year-old marked "senior" ages into "junior" pay
  // brackets fine (those are computed fresh below), but age_group itself
  // is only ever written at import or by hand. Recompute it from their
  // birthday whenever one's on file; only fall back to the stored value
  // for the small number of staff with no birthday recorded at all.
  const ageGroupOf = (s: { birthday?: string | null; age_group: 'junior' | 'senior' }): 'junior' | 'senior' =>
    seniorityFromBirthday(s.birthday, date) ?? s.age_group;

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
  const seniorAvailable = (allStaff ?? []).some(s => ageGroupOf(s) === 'senior');

  /** Everyone trained in `poolDeptId`, available, and otherwise eligible —
   *  `ageFilter` narrows further for the Checkout fallback pool below. */
  const eligibleIn = (poolDeptId: string, ageFilter?: 'junior' | 'senior') =>
    (allStaff ?? []).filter(s => {
      // Salaried staff are paid the same whether or not they cover a shift, so
      // there's no incentive to offer it to them. Never enters the race.
      if (s.employment_type === 'salary') return false;

      // Nobody gets offered a shift on their own birthday.
      if (isBirthday(s.birthday, date)) return false;

      // Never re-offer the exact shift someone was just pulled out of.
      if (exclude_staff_id && s.id === exclude_staff_id) return false;

      const deptIds = (s.staff_departments ?? []).map((d: { department_id: string }) => d.department_id);
      if (!deptIds.includes(poolDeptId)) return false;

      if (dept.requires_supervisor && ageGroupOf(s) === 'junior' && !seniorAvailable) return false;

      if (required_role && required_role !== 'any' && ageGroupOf(s) !== required_role) return false;
      if (ageFilter && ageGroupOf(s) !== ageFilter) return false;

      const slots = availMap.get(s.id);
      if (slots && slots.length > 0) {
        return slots.some(slot =>
          availabilityCoversShift(slot.start_time, slot.end_time, start_time, end_time));
      }
      if (staffWithAnyAvail.has(s.id)) return false;
      return true;
    });

  let eligible = eligibleIn(department_id);
  let fallbackPool: EligibilityResult['fallback_pool'] = null;

  // Nobody trained in the shift's own department is both eligible and
  // available — rather than come back empty, widen to Checkout staff,
  // juniors preferred and seniors only if that's still nobody. A shift's
  // required_role (if set) still applies within this wider pool, same as
  // it did in the home department.
  if (eligible.length === 0 && checkoutDept && checkoutDept.id !== department_id) {
    const juniors = eligibleIn(checkoutDept.id, 'junior');
    if (juniors.length > 0) {
      eligible = juniors;
      fallbackPool = 'checkout_junior';
    } else {
      const seniors = eligibleIn(checkoutDept.id, 'senior');
      if (seniors.length > 0) {
        eligible = seniors;
        fallbackPool = 'checkout_senior';
      }
    }
  }

  // A shift they've already got wins over one they might claim — someone
  // otherwise eligible can still have a scheduling conflict (an overlapping
  // shift elsewhere the same day) or already be booked close to the weekly
  // cap. Both are checked against everyone's actual roster for the week, not
  // just this one shift.
  const { weekStart, weekEnd } = weekBounds(date);
  type WeekShift = { id: string; assigned_staff_id: string; date: string; start_time: string; end_time: string };
  const shiftsByStaff = new Map<string, WeekShift[]>();

  if (eligible.length > 0) {
    const { data: weekShiftRows, error: weekShiftErr } = await supabaseAdmin
      .from('shifts')
      .select('id, assigned_staff_id, date, start_time, end_time')
      .eq('status', 'covered')
      .gte('date', weekStart).lte('date', weekEnd)
      .in('assigned_staff_id', eligible.map(s => s.id));
    if (weekShiftErr) throw new Error(weekShiftErr.message);

    for (const row of (weekShiftRows ?? []) as WeekShift[]) {
      if (!shiftsByStaff.has(row.assigned_staff_id)) shiftsByStaff.set(row.assigned_staff_id, []);
      shiftsByStaff.get(row.assigned_staff_id)!.push(row);
    }
  }

  // The award structure, so a manager can weigh cost alongside suitability.
  // A missing birthday isn't an error: the person still shows, just without
  // a figure, which is more honest than costing them at zero.
  const [baseRes, bracketsRes, loadingsRes, holidayRes, tiersRes, overridesRes] = await Promise.all([
    supabaseAdmin.from('wage_base_rate').select('adult_hourly_rate').eq('id', 'current').maybeSingle(),
    supabaseAdmin.from('age_brackets').select('*'),
    supabaseAdmin.from('time_loadings').select('*'),
    supabaseAdmin.from('public_holidays').select('date').eq('date', date).maybeSingle(),
    supabaseAdmin.from('overtime_tiers').select('*'),
    supabaseAdmin.from('overtime_overrides').select('*'),
  ]);
  const adultBaseRate = baseRes.data?.adult_hourly_rate ? Number(baseRes.data.adult_hourly_rate) : null;
  const ageBrackets = (bracketsRes.data ?? []) as AgeBracket[];
  const timeLoadings = (loadingsRes.data ?? []) as TimeLoading[];
  const isPublicHoliday = !!holidayRes.data;
  const overtimeTiers = (tiersRes.data ?? []) as OvertimeTier[];
  const overtimeOverrides = (overridesRes.data ?? []) as OvertimeOverride[];
  const breakMinutes = requiresBreak(start_time.slice(0, 5), end_time.slice(0, 5)) ? BREAK_DURATION_MINUTES : 0;

  const costFor = (s: (typeof allStaff)[number]): { cost: number | null; reason: ScoredCandidate['cost_reason'] } => {
    if (adultBaseRate === null) return { cost: null, reason: 'no_base_rate' };
    if (s.employment_type === 'salary') return { cost: null, reason: 'salary' };
    const category: EmploymentCategory = s.employment_type === 'casual' ? 'casual' : 'ft_pt';
    const bracket = ageBracketFor(s.birthday, date, s.commencement_date, ageBrackets);
    if (!bracket) return { cost: null, reason: 'no_birthday' };
    const cost = calculateShiftCost(
      {
        date, start_time, end_time, unpaid_break_minutes: breakMinutes,
        employment_category: category, age_percentage: bracket.percentage,
      },
      adultBaseRate, timeLoadings, isPublicHoliday, overtimeTiers, overtimeOverrides
    ).cost;
    return { cost, reason: null };
  };

  const scoreOf = (s: (typeof allStaff)[number]): number => {
    let score = s.reliability_score ?? 50;
    if (dept.requires_supervisor && ageGroupOf(s) === 'senior') score += 10;
    if (s.role_type === 'all_rounder') score += 5;
    if (s.role_type === 'potential_all_rounder') score += 2;
    if (s.role_type === 'department_only') score -= 2;
    if (availMap.has(s.id)) score += 3;
    return score;
  };

  const buildCandidate = (s: (typeof allStaff)[number], weeklyBefore: number): ScoredCandidate => {
    const { cost, reason } = costFor(s);
    return {
      id: s.id,
      name: s.name,
      age_group: ageGroupOf(s),
      role_type: s.role_type,
      reliability_score: s.reliability_score ?? 50,
      phone: s.phone ?? null,
      phone_e164: s.phone_e164 ?? null,
      sms_opt_out: s.sms_opt_out ?? false,
      computed_score: scoreOf(s),
      trained_departments: s.staff_departments ?? [],
      weekly_minutes_before: weeklyBefore,
      weekly_minutes_after: weeklyBefore + shiftDurationMinutes(start_time, end_time),
      shift_cost: cost,
      cost_reason: reason,
    };
  };

  const candidates: ScoredCandidate[] = [];
  const extendable: ExtendableCandidate[] = [];
  const overlapExcluded: OverlapConflict[] = [];
  const backup: ScoredCandidate[] = [];

  for (const s of eligible) {
    const weekShifts = shiftsByStaff.get(s.id) ?? [];
    const conflict = weekShifts.find(w => w.date === date && shiftsOverlap(w.start_time, w.end_time, start_time, end_time));

    if (conflict) {
      const merged = mergeShiftRanges(conflict.start_time, conflict.end_time, start_time, end_time);
      if (shiftDurationMinutes(merged.start_time, merged.end_time) <= MAX_EXTENDED_SHIFT_MINUTES) {
        extendable.push({
          id: s.id, name: s.name, phone: s.phone ?? null, phone_e164: s.phone_e164 ?? null,
          existing_shift: { id: conflict.id, start_time: conflict.start_time, end_time: conflict.end_time },
          proposed: merged,
        });
      } else {
        overlapExcluded.push({
          id: s.id, name: s.name,
          existing_shift: { start_time: conflict.start_time, end_time: conflict.end_time },
        });
      }
      continue;
    }

    const weeklyBefore = weekShifts.reduce((sum, w) => sum + shiftDurationMinutes(w.start_time, w.end_time), 0);
    const candidate = buildCandidate(s, weeklyBefore);

    if (candidate.weekly_minutes_after > WEEKLY_HOURS_CAP_MINUTES) {
      backup.push(candidate);
    } else {
      candidates.push(candidate);
    }
  }

  // Cheapest first, reliability breaking ties — the store manager picks on
  // price, so the list is ordered the way she reads it.
  return {
    department: dept,
    candidates: rankCandidates(candidates),
    extendable,
    overlapExcluded,
    backup: rankCandidates(backup),
    fallback_pool: fallbackPool,
  };
}
