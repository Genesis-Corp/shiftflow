export type AgeGroup = 'junior' | 'senior';
export type RoleType = 'department_only' | 'all_rounder' | 'potential_all_rounder';
export type ShiftStatus = 'open' | 'covered' | 'cancelled';
export type RequiredRole = 'junior' | 'senior' | 'any';
export type TrainingLevel = 'trained' | 'supervised' | 'advanced';
export type IncidentType = 'no_show' | 'no_answer' | 'rejected' | 'covered';
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Staff {
  id: string;
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  age_group: AgeGroup;
  role_type: RoleType;
  reliability_score: number;
  active: boolean;
  phone?: string;
  created_at: string;
  // joined fields
  staff_departments?: StaffDepartment[];
  departments?: Department[];
}

export interface Department {
  id: string;
  name: string;
  requires_supervisor: boolean;
  created_at: string;
}

export interface StaffDepartment {
  id?: string;
  staff_id: string;
  department_id: string;
  training_level: TrainingLevel;
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
}

export interface CoverShiftResult {
  shift: Shift;
  eligible_count: number;
  candidates: CoverCandidate[];
}

export interface ClaimRaceResult {
  message: string;
  first_contacted?: string;
  remaining_queue?: string[];
}
