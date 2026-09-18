export type AgeGroup = 'junior' | 'senior';
export type RoleType = 'department_only' | 'all_rounder' | 'potential_all_rounder';
export type ShiftStatus = 'open' | 'covered' | 'cancelled';
export type RequiredRole = 'junior' | 'senior' | 'any';
export type TrainingLevel = 'trained' | 'supervised' | 'advanced';
export type IncidentType = 'no_show' | 'no_answer' | 'rejected' | 'covered';
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type EmploymentType = 'casual' | 'part_time' | 'full_time' | 'salary';

export interface Staff {
  id: string;
  name: string;
  age_group: AgeGroup;
  role_type: RoleType;
  reliability_score: number;
  active: boolean;
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

export interface Shift {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  department_id: string;
  required_role: RequiredRole;
  status: ShiftStatus;
  assigned_staff_id?: string;
  has_break: boolean;
  break_duration_minutes: number;
  notes?: string;
  created_at: string;
  // joined fields
  departments?: Department;
  assigned_staff?: Staff;
}

export interface ReliabilityIncident {
  id: string;
  staff_id: string;
  incident_type: IncidentType;
  shift_id?: string;
  date: string;
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
}

// ── Claim race ───────────────────────────────────────────────────────────────

export type SmsMode = 'console' | 'redirect' | 'live';
export type RaceStatus = 'active' | 'claimed' | 'expired' | 'cancelled';
export type RecipientSendStatus =
  | 'queued' | 'sent' | 'failed' | 'skipped_no_phone' | 'skipped_opted_out';
export type RecipientOutcome = 'won' | 'lost' | 'declined' | 'no_response';

export interface ClaimRace {
  id: string;
  shift_id: string;
  status: RaceStatus;
  winner_staff_id?: string | null;
  mode: SmsMode;
  expires_at: string;
  created_at: string;
  claimed_at?: string | null;
  cancelled_at?: string | null;
  shifts?: Shift & { departments?: Department };
}

export interface ClaimRecipient {
  id: string;
  race_id: string;
  staff_id: string;
  claim_code: string;
  rank?: number | null;
  computed_score?: number | null;
  phone_e164?: string | null;
  send_status: RecipientSendStatus;
  send_error?: string | null;
  outcome?: RecipientOutcome | null;
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
