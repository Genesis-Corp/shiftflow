import { supabaseAdmin as supabase } from './supabaseAdmin';
import type { SchoolHolidayRange } from './schoolTerms';

/**
 * Writes a batch of school holiday ranges, replacing any already stored for
 * the same start date. Both ways of filling this calendar in bulk — reading
 * it off the location, and reading it off an uploaded term dates page — are
 * things a manager may well do twice, so neither should stack duplicates the
 * second time.
 */
export async function replaceSchoolHolidays(rows: SchoolHolidayRange[]): Promise<string | null> {
  if (!rows.length) return null;

  const { data: existing, error: readErr } = await supabase.from('school_holidays').select('id, start_date');
  if (readErr) return describeDbError(readErr);

  const idByStart = new Map((existing ?? []).map((r: { id: string; start_date: string }) => [r.start_date, r.id]));
  const superseded = rows.map(r => idByStart.get(r.start_date)).filter((id): id is string => !!id);
  if (superseded.length) {
    const { error } = await supabase.from('school_holidays').delete().in('id', superseded);
    if (error) return describeDbError(error);
  }

  // `estimated` rides along on a scanned range to flag it in the preview;
  // it isn't a stored fact, so it never reaches the insert.
  const { error } = await supabase
    .from('school_holidays')
    .insert(rows.map(({ start_date, end_date, name }) => ({ start_date, end_date, name })));
  return error ? describeDbError(error) : null;
}

/** Postgres "undefined_table" — the one failure here with an obvious fix, and
 *  otherwise a bare "relation does not exist" that reads like an app bug. */
export function describeDbError(error: { code?: string; message: string }): string {
  if (error.code === '42P01') {
    return 'The school_holidays table does not exist yet — run supabase-migrations/20260930b_school_holidays.sql against the database, then try again.';
  }
  return error.message;
}
