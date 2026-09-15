export interface AutomationFlag {
  /** Which department this flag is about, or null when it's about the whole run. */
  department: string | null;
  kind:
    | 'unmatched_department'
    /** Ambiguous — more than one existing staff member could be this name. */
    | 'unmatched_staff'
    | 'unreadable'
    | 'warning'
    | 'error'
    | 'empty_read'
    /** Informational — a name matched nobody at all, so it was added as new staff. */
    | 'staff_created';
  message: string;
}

export interface AutomationRun {
  id: string;
  created_at: string;
  roster_date: string;
  source: string;
  departments_applied: number;
  shifts_created: number;
  flags: AutomationFlag[];
  acknowledged_at: string | null;
}
