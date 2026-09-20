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
  if (readErr) return readErr.message;

  const idByStart = new Map((existing ?? []).map((r: { id: string; start_date: string }) => [r.start_date, r.id]));
  const superseded = rows.map(r => idByStart.get(r.start_date)).filter((id): id is string => !!id);
  if (superseded.length) {
    const { error } = await supabase.from('school_holidays').delete().in('id', superseded);
    if (error) return error.message;
  }

  const { error } = await supabase.from('school_holidays').insert(rows);
  return error ? error.message : null;
}
