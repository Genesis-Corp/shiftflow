import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { toE164AU } from '@/lib/phone';
import { requireUser, unauthorized } from '@/lib/auth';
import { nameKey, fullName } from '@/lib/availabilitySheet';
import { withNameParts } from '@/lib/staffNames';
import { seniorityFromBirthday } from '@/lib/wages';

// ── Full staff sheet (First Name / Last Name / Employment Type / Default
//    Department / Default Role / Birth Date / Pay Rate / Mobile) ──────────────
// A whole-of-store export — likely to list people already in the app, so rows
// are matched by name and updated rather than blindly re-inserted.
interface FullStaffRow {
  'First Name'?: string;
  'Last Name'?: string;
  'Employment Type'?: string;
  'Default Department'?: string;
  'Default Role'?: string;
  'Birth Date'?: string;
  'Pay Rate'?: string;
  'Mobile'?: string;
}

function isFullStaffSheet(row: Record<string, string>): boolean {
  return 'First Name' in row && 'Last Name' in row;
}

/** "31/03/2000" -> "2000-03-31". Null if it doesn't parse as a real date —
 *  parsed by hand rather than handed to Postgres raw, since a DD/MM string
 *  is exactly the kind of thing that silently becomes the wrong day if the
 *  database ever reads it as MM/DD instead. */
function parseAuDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]), month = Number(m[2]), year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** staff.age_group (the claim-race Junior/Senior split, a fixed 18-year
 *  cutoff — a different concept from the wage engine's eight-bracket age
 *  table) is computed from birthday whenever we have one, since that's the
 *  one field this sheet can't get stale: a birthday doesn't change. The
 *  "Pay Rate" column ("Adult", "17 Years Old", "Under16") only stands in
 *  for the rare row with no Birth Date at all — "Adult" reads as senior,
 *  anything else as junior. Null when neither tells us anything, so a
 *  guess never overwrites (or seeds) a value with no actual basis. */
function staffAgeGroupFor(payRate: string | undefined, birthday: string | null): 'junior' | 'senior' | null {
  const fromBirthday = seniorityFromBirthday(birthday, new Date().toISOString().slice(0, 10));
  if (fromBirthday) return fromBirthday;
  const label = (payRate ?? '').trim().toLowerCase();
  if (label === 'adult') return 'senior';
  if (label) return 'junior';
  return null;
}

// ── Standard staff CSV format ─────────────────────────────────────────────────
interface StandardRow {
  name?: string;
  age_group?: string;
  role_type?: string;
  phone?: string;
  departments?: string;
  birthday?: string;
  employment_type?: string;
  commencement_date?: string;
}

// ── Availability-sheet format (STORE / NAME / MOBILE # / day columns) ─────────
type AvailabilityRow = Record<string, string>;

const DAY_COLUMNS: Record<string, number> = {
  SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3,
  THURSDAY: 4, FRIDAY: 5, SATURDAY: 6,
};

function isAvailabilitySheet(row: AvailabilityRow): boolean {
  return 'NAME' in row && 'MOBILE #' in row;
}

/** Parse "6AM" or "2PM" → "06:00:00" */
function parseTimePart(t: string): string | null {
  const m = t.trim().match(/^(\d{1,2})(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1]);
  const period = m[2].toUpperCase();
  if (period === 'PM' && h !== 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:00:00`;
}

/** Parse "6AM-2PM" → { start: "06:00:00", end: "14:00:00" } or null */
function parseTimeRange(range: string): { start: string; end: string } | null {
  const parts = range.trim().split('-');
  if (parts.length !== 2) return null;
  const start = parseTimePart(parts[0]);
  const end = parseTimePart(parts[1]);
  if (!start || !end) return null;
  return { start, end };
}

// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { rows }: { rows: AvailabilityRow[] } = await req.json();
  if (!rows?.length) return NextResponse.json({ error: 'No rows provided' }, { status: 400 });

  const { data: departments } = await supabase.from('departments').select('id, name, is_default');
  const deptMap = new Map(
    (departments ?? []).map((d: { id: string; name: string }) => [d.name.toLowerCase().trim(), d.id])
  );
  const defaultDeptId = (departments ?? []).find((d: { is_default?: boolean }) => d.is_default)?.id ?? null;

  /**
   * Find the department matching `name`, creating it if this exact name
   * hasn't been seen before. Rosters get uploaded per department — if the
   * STORE column doesn't match an existing department (typo, or a store
   * name nobody has entered as a department yet), the right fallback isn't
   * "leave this person with no department", it's "the department really is
   * whatever roster they just came off". Cached in deptMap so a second row
   * in the same upload with the same STORE value reuses it instead of
   * creating a duplicate.
   */
  async function findOrCreateDepartment(name: string): Promise<string | null> {
    const key = name.toLowerCase().trim();
    if (!key) return null;
    const existing = deptMap.get(key);
    if (existing) return existing;

    const { data, error } = await supabase
      .from('departments').insert([{ name: name.trim() }]).select('id').single();
    if (error || !data) return null;
    deptMap.set(key, data.id);
    return data.id;
  }

  const results = { created: 0, updated: 0, archived_skipped: 0, errors: [] as string[] };
  const EMPLOYMENT_TYPES = new Set(['casual', 'part_time', 'full_time', 'salary']);

  // ── Detect format from first row ───────────────────────────────────────────
  if (isFullStaffSheet(rows[0] as unknown as Record<string, string>)) {
    // Whole-of-store export — most rows likely already exist, so match by
    // name and update rather than re-inserting duplicates. Matching still
    // includes archived staff (people who've left) so they're never
    // recreated as a new hire — their record just isn't touched; bringing
    // someone back is a deliberate Reinstate on the Staff page, not
    // something a passive CSV re-upload should do on its own.
    const { data: existingRows } = await supabase
      .from('staff').select('id, name, birthday, employment_type, age_group, phone, phone_e164, archived');
    const existingByName = new Map(
      (existingRows ?? []).map((s: { name: string }) => [nameKey(s.name ?? ''), s])
    );

    for (const row of rows as unknown as FullStaffRow[]) {
      const first = row['First Name']?.trim();
      const last = row['Last Name']?.trim() ?? '';
      if (!first) {
        results.errors.push(`Skipped row (missing First Name): ${JSON.stringify(row)}`);
        continue;
      }
      const name = fullName(first, last);

      const employmentTypeRaw = row['Employment Type']?.toLowerCase().trim().replace(/[\s-]+/g, '_') ?? '';
      const employmentType = EMPLOYMENT_TYPES.has(employmentTypeRaw) ? employmentTypeRaw : null;
      if (employmentTypeRaw && !employmentType) {
        results.errors.push(`"${name}": unrecognized Employment Type "${row['Employment Type']}", left blank.`);
      }

      const birthdayRaw = row['Birth Date']?.trim();
      const birthday = birthdayRaw ? parseAuDate(birthdayRaw) : null;
      if (birthdayRaw && !birthday) {
        results.errors.push(`"${name}": could not read Birth Date "${birthdayRaw}" (expected DD/MM/YYYY), left blank.`);
      }

      const ageGroup = staffAgeGroupFor(row['Pay Rate'], birthday);
      const phone = row['Mobile']?.trim() || null;
      const phoneE164 = toE164AU(phone);

      const existing = existingByName.get(nameKey(name)) as
        { id: string; birthday: string | null; employment_type: string | null; age_group: string | null; phone: string | null; archived: boolean } | undefined;

      if (existing?.archived) {
        results.archived_skipped++;
        continue;
      }

      if (existing) {
        // These staff already exist — this sheet is the current export of
        // record, so any field it actually has a value for overwrites what's
        // on file rather than just filling gaps. A blank cell means "no
        // update", not "clear this field", so it never wipes existing data.
        const updates: Record<string, unknown> = {};
        if (birthday && existing.birthday !== birthday) updates.birthday = birthday;
        if (employmentType && existing.employment_type !== employmentType) updates.employment_type = employmentType;
        if (ageGroup && existing.age_group !== ageGroup) updates.age_group = ageGroup;
        if (phone && existing.phone !== phone) { updates.phone = phone; updates.phone_e164 = phoneE164; }

        if (Object.keys(updates).length) {
          const { error } = await supabase.from('staff').update(updates).eq('id', existing.id);
          if (error) { results.errors.push(`Failed to update "${name}": ${error.message}`); continue; }
          results.updated++;
        }
        continue;
      }

      const payload = await withNameParts({
        name,
        age_group: ageGroup ?? 'senior',
        role_type: 'department_only',
        phone,
        phone_e164: phoneE164,
        birthday,
        employment_type: employmentType,
        reliability_score: 50,
        active: true,
      }, name);

      const { data: staff, error } = await supabase.from('staff').insert([payload]).select().single();
      if (error) { results.errors.push(`Failed to import "${name}": ${error.message}`); continue; }

      const deptName = row['Default Department']?.trim();
      const deptId = deptName ? await findOrCreateDepartment(deptName) : defaultDeptId;
      if (deptId) {
        await supabase.from('staff_departments').insert([{
          staff_id: staff.id, department_id: deptId, training_level: 'trained', is_default: true,
        }]);
      }

      results.created++;
    }

    if (results.archived_skipped) {
      results.errors.push(
        `${results.archived_skipped} row(s) matched an archived staff member and were left unchanged — ` +
        'reinstate them from the Archive on the Staff page first if they\'re back.'
      );
    }

    return NextResponse.json(results);
  }

  if (isAvailabilitySheet(rows[0])) {
    for (const row of rows) {
      const name = row['NAME']?.trim();
      const phone = row['MOBILE #']?.trim() ?? null;
      const storeName = row['STORE']?.trim();

      if (!name) {
        results.errors.push(`Skipped row (missing NAME): ${JSON.stringify(row)}`);
        continue;
      }

      // Insert staff with sensible defaults for fields not in this sheet
      const { data: staff, error: staffErr } = await supabase
        .from('staff')
        .insert([{
          name,
          phone: phone || null,
          phone_e164: toE164AU(phone),
          age_group: 'junior',
          role_type: 'department_only',
          reliability_score: 50,
          active: true,
        }])
        .select()
        .single();

      if (staffErr) {
        results.errors.push(`Failed to import "${name}": ${staffErr.message}`);
        continue;
      }

      // Link to the STORE column's department, creating it if this is the
      // first time this roster's store name has been seen — a staff member
      // should never end up with zero departments just because their
      // roster's STORE label doesn't exactly match one already on file.
      if (storeName) {
        const deptId = await findOrCreateDepartment(storeName);
        if (deptId) {
          await supabase.from('staff_departments').insert([{
            staff_id: staff.id,
            department_id: deptId,
            training_level: 'trained',
          }]);
        }
      }

      // Parse day columns into availability_templates
      const availabilityRows: {
        staff_id: string;
        day_of_week: number;
        start_time: string;
        end_time: string;
        available: boolean;
      }[] = [];

      for (const [col, dayIndex] of Object.entries(DAY_COLUMNS)) {
        const cellValue = row[col]?.trim() ?? '';
        if (!cellValue) continue;
        const parsed = parseTimeRange(cellValue);
        if (!parsed) continue; // skip cells that aren't valid time ranges (e.g. "MEAT")
        availabilityRows.push({
          staff_id: staff.id,
          day_of_week: dayIndex,
          start_time: parsed.start,
          end_time: parsed.end,
          available: true,
        });
      }

      if (availabilityRows.length) {
        await supabase.from('availability_templates').insert(availabilityRows);
      }

      results.created++;
    }

    return NextResponse.json(results);
  }

  // ── Standard format ────────────────────────────────────────────────────────
  for (const row of rows as unknown as StandardRow[]) {
    if (!row.name || !row.age_group || !row.role_type) {
      results.errors.push(`Skipped row (missing fields): ${JSON.stringify(row)}`);
      continue;
    }

    const employmentType = row.employment_type?.toLowerCase().trim().replace(/[\s-]+/g, '_') ?? '';
    if (employmentType && !EMPLOYMENT_TYPES.has(employmentType)) {
      results.errors.push(`"${row.name}": unrecognized employment_type "${row.employment_type}", left blank.`);
    }

    const { data: staff, error } = await supabase
      .from('staff')
      .insert([{
        name: row.name.trim(),
        age_group: row.age_group.toLowerCase().trim(),
        role_type: row.role_type.toLowerCase().replace(/\s+/g, '_').trim(),
        phone: row.phone?.trim() ?? null,
        phone_e164: toE164AU(row.phone),
        birthday: row.birthday?.trim() || null,
        employment_type: EMPLOYMENT_TYPES.has(employmentType) ? employmentType : null,
        commencement_date: row.commencement_date?.trim() || null,
        reliability_score: 50,
        active: true,
      }])
      .select()
      .single();

    if (error) {
      results.errors.push(`Failed to import "${row.name}": ${error.message}`);
      continue;
    }

    if (staff) {
      const deptNames = row.departments ? row.departments.split(',').map(n => n.trim().toLowerCase()) : [];
      const deptIds = deptNames.map(n => deptMap.get(n)).filter(Boolean) as string[];

      // Whichever department this person is rostered for on the sheet
      // becomes their default (home) department — the first one named if
      // more than one is listed. No department named, or none of the named
      // ones matched — fall back to whichever department is flagged store
      // default, so this person doesn't end up with zero departments just
      // because the CSV column was empty.
      const assignments = deptIds.length
        ? deptIds.map((dept_id, i) => ({
            staff_id: staff.id, department_id: dept_id, training_level: 'trained', is_default: i === 0,
          }))
        : defaultDeptId
          ? [{ staff_id: staff.id, department_id: defaultDeptId, training_level: 'trained', is_default: true }]
          : [];

      if (assignments.length) {
        await supabase.from('staff_departments').insert(assignments);
      }
    }

    results.created++;
  }

  return NextResponse.json(results);
}
