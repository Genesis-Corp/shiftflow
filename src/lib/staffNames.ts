/**
 * Helpers for the staff `first_name` / `last_name` columns.
 *
 * Those columns arrived with the availability-sheet sync (see
 * supabase-migrations/20260913_staff_name_parts.sql). A deployment that has not
 * run the migration yet still works: `hasNameColumns()` reports false and
 * callers fall back to the combined `name`.
 */

import { supabase } from './supabase';

let present: boolean | null = null;

export async function hasNameColumns(): Promise<boolean> {
  if (present === null) {
    const { error } = await supabase.from('staff').select('first_name').limit(1);
    present = !error;
  }
  return present;
}

/**
 * Split a display name for staff typed into the app by hand. The first word is
 * the first name and the rest is the surname, which keeps "Isaac Di Stefano"
 * intact; the sheet's own two columns win whenever a sync runs.
 */
export function splitName(name: string): { first_name: string; last_name: string | null } {
  const parts = name.replace(/\s+/g, ' ').trim().split(' ');
  return {
    first_name: parts[0] ?? '',
    last_name: parts.length > 1 ? parts.slice(1).join(' ') : null,
  };
}

/** Add the name columns to a staff insert/update payload when they exist. */
export async function withNameParts<T extends Record<string, unknown>>(
  payload: T,
  name: string | undefined | null
): Promise<T> {
  if (!name || !(await hasNameColumns())) return payload;
  return { ...payload, ...splitName(name) };
}
