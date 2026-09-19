/** Match a name read off a scanned leave form to a known staff member. */

interface NamedStaff {
  id: string;
  name: string;
}

/**
 * Exact full-name match first; falls back to first-name-only when the form
 * only gives a first name (e.g. "Eli and Aria" on a Request Day Off form)
 * and exactly one active staff member has that first name. Returns null
 * rather than guessing when nothing matches or more than one person could.
 */
export function matchStaffName(rawName: string, staff: NamedStaff[]): string | null {
  const clean = rawName.trim().toLowerCase();
  if (!clean) return null;

  const exact = staff.find(s => s.name.trim().toLowerCase() === clean);
  if (exact) return exact.id;

  const firstWord = clean.split(/\s+/)[0];
  const byFirstName = staff.filter(s => s.name.trim().toLowerCase().split(/\s+/)[0] === firstWord);
  return byFirstName.length === 1 ? byFirstName[0].id : null;
}
