export type AgeGroup = 'junior' | 'senior';
export type RoleType = 'department_only' | 'all_rounder' | 'potential_all_rounder';
export type ShiftStatus = 'open' | 'covered' | 'cancelled';
export type RequiredRole = 'junior' | 'senior' | 'any';
export type TrainingLevel = 'trained' | 'supervised' | 'advanced';
export type IncidentType = 'no_show' | 'no_answer' | 'rejected' | 'covered' | 'late' | 'opted_out_sms';
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type EmploymentType = 'casual' | 'part_time' | 'full_time' | 'salary';

export interface Staff {
  id: string;
  name: string;
  age_group: AgeGroup;
  role_type: RoleType;
  reliability_score: number;
  active: boolean;
  /** Left the store — kept (not deleted) so a future roster or CSV upload
   *  that still lists them matches this record instead of duplicating it. */
  archived: boolean;
  archived_at?: string | null;
  phone?: string;
  phone_e164?: string | null;
  sms_opt_out?: boolean;
  /** "MM-DD" or a full date string — only the month and day are ever used. */
  birthday?: string | null;
  employment_type?: EmploymentType | null;
  /** Needed for the 20-21 age bracket's under-6-months vs 6-months-plus split. */
  commencement_date?: string | null;
  created_at: string;
  // joined fields
  staff_departments?: StaffDepartment[];
  departments?: Department[];
}

export interface Department {
  id: string;
  name: string;
  requires_supervisor: boolean;
  /** Never offered in the Cover Shift picker — a manager can't start a claim race for it. */
  excluded_from_claim_race: boolean;
  color?: string | null;
  is_default?: boolean;
  created_at: string;
}

export interface StaffDepartment {
  id?: string;
  staff_id: string;
  department_id: string;
  training_level: TrainingLevel;
  /** Their home department — at most one true per staff member. */
  is_default?: boolean;
  departments?: Department;
}

export interface AvailabilityTemplate {
  id: string;
  staff_id: string;
  day_of_week: DayOfWeek;
  start_time: string;
  end_time: string;
  available: boolean;
}

export type LeaveType = 'day_off' | 'leave';

export interface SchoolHoliday {
  id: string;
  start_date: string;
  end_date: string;
  name: string;
  created_at: string;
}

export interface StaffLeave {
  id: string;
  staff_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  file_path: string | null;
  file_name: string | null;
  /** A short-lived signed URL, attached by the API on read — never stored. */
  file_url?: string | null;
  notes?: string | null;
  created_at: string;
  staff?: Pick<Staff, 'id' | 'name'>;
}

export interface Shift {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  department_id: string;
  required_role: RequiredRole;
  status: ShiftStatus;
  assigned_staff_id?: string;
  /** Who this shift was just reopened from (e.g. a sick call) — excluded
   *  from eligibility for this shift specifically until it's assigned to
   *  someone for real, so they can't be offered the exact shift they just
   *  called in sick for. */
  excluded_staff_id?: string | null;
  has_break: boolean;
  break_duration_minutes: number;
  notes?: string;
  created_at: string;
  // joined fields
  departments?: Department;
  assigned_staff?: Staff;
  /** The currently active shift_claim_races row for this shift, if any —
   *  a shift stays 'open' for its whole duration, so a second race can
   *  otherwise be started for one that's already mid-race. */
  active_race_id?: string | null;
}

export interface ReliabilityIncident {
  id: string;
  staff_id: string;
  incident_type: IncidentType;
  shift_id?: string;
  date: string;
  /** Time they actually arrived — only set (and only meaningful) for a 'late' incident. */
  late_time?: string | null;
  notes?: string;
  created_at: string;
  staff?: Staff;
}

export interface CoverCandidate extends Staff {
  computed_score: number;
  trained_departments: Department[];
  weekly_minutes_before: number;
  weekly_minutes_after: number;
  /** Cost of this shift with them on it, or null when they have no rate set. */
  shift_cost: number | null;
  /** Why shift_cost is null — null when shift_cost itself isn't null. */
  cost_reason: 'no_base_rate' | 'salary' | 'no_birthday' | null;
  /** No-showed or called in sick within the last 3 days — still offered, but ranked near the bottom of the list. */
  recently_absent: boolean;
}

export interface ExtendableCandidate {
  id: string;
  name: string;
  phone: string | null;
  phone_e164: string | null;
  existing_shift: { id: string; start_time: string; end_time: string };
  proposed: { start_time: string; end_time: string };
}

export interface OverlapConflict {
  id: string;
  name: string;
  existing_shift: { start_time: string; end_time: string };
}

export interface CoverShiftResult {
  shift: Shift;
  eligible_count: number;
  candidates: CoverCandidate[];
  extendable: ExtendableCandidate[];
  overlapExcluded: OverlapConflict[];
  backup: CoverCandidate[];
  /** Set when nobody trained in the shift's own department was eligible and
   *  the candidate pool was widened — automatically to Checkout staff
   *  (juniors first, seniors only if no juniors were available either), or
   *  to absolutely everyone via the manual "Expand Search" override. */
  fallback_pool: 'checkout_junior' | 'checkout_senior' | 'expanded' | null;
}

// ── Claim race ───────────────────────────────────────────────────────────────

export type SmsMode = 'console' | 'redirect' | 'live';
export type RaceStatus = 'active' | 'claimed' | 'expired' | 'cancelled' | 'awaiting_pick';
export type RaceTier = 'immediate' | 'gather' | 'sequential';
export type RecipientSendStatus =
  | 'queued' | 'sent' | 'failed' | 'skipped_no_phone' | 'skipped_opted_out';
export type RecipientOutcome = 'won' | 'lost' | 'declined' | 'no_response';

export interface ClaimRace {
  id: string;
  shift_id: string;
  status: RaceStatus;
  winner_staff_id?: string | null;
  mode: SmsMode;
  tier: RaceTier;
  expires_at: string;
  created_at: string;
  claimed_at?: string | null;
  cancelled_at?: string | null;
  started_by?: string | null;
  current_batch?: number | null;
  batch_deadline?: string | null;
  gather_deadline?: string | null;
  degraded_at?: string | null;
  sequential_index?: number | null;
  step_deadline?: string | null;
  shifts?: Shift & { departments?: Department };
}

export interface ClaimRecipient {
  id: string;
  race_id: string;
  staff_id: string;
  claim_code: string;
  rank?: number | null;
  computed_score?: number | null;
  shift_cost?: number | null;
  phone_e164?: string | null;
  send_status: RecipientSendStatus;
  send_error?: string | null;
  outcome?: RecipientOutcome | null;
  is_available?: boolean | null;
  option_number?: number | null;
  responded_at?: string | null;
  response_body?: string | null;
  staff?: Pick<Staff, 'id' | 'name' | 'age_group' | 'reliability_score'>;
}

export interface SmsMessage {
  id: string;
  race_id?: string | null;
  staff_id?: string | null;
  direction: 'out' | 'in';
  kind?: string | null;
  to_phone?: string | null;
  body: string;
  mode?: string | null;
  intended_for?: string | null;
  status?: string | null;
  error?: string | null;
  created_at: string;
}

export interface RaceDetail {
  race: ClaimRace;
  recipients: ClaimRecipient[];
  messages: SmsMessage[];
}

export interface RacePreview {
  shift: Shift & { departments?: Department };
  contactable: {
    id: string; name: string; phone_e164: string | null;
    computed_score: number; age_group: AgeGroup;
  }[];
  excluded: { staffId: string; name: string; reason: 'no_phone' | 'opted_out' }[];
  extendable: ExtendableCandidate[];
  backup: CoverCandidate[];
  active_race_id: string | null;
}

export interface SmsConfig {
  mode: SmsMode;
  test_number: string | null;
  allowlist_size: number;
  timezone: string;
  expiry_minutes: number;
  quiet_hours_now: boolean;
  simulation_enabled: boolean;
}
