import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { toE164AU } from '@/lib/phone';
import { requireUser, unauthorized } from '@/lib/auth';

// ── Standard staff CSV format ─────────────────────────────────────────────────
interface StandardRow {
  name?: string;
  age_group?: string;
  role_type?: string;
  phone?: string;
  departments?: string;
  birthday?: string;
  employment_type?: string;
  pay_rate?: string;
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

  const results = { created: 0, errors: [] as string[] };

  // ── Detect format from first row ───────────────────────────────────────────
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

  const EMPLOYMENT_TYPES = new Set(['casual', 'part_time', 'full_time', 'salary']);

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
    const payRate = row.pay_rate ? Number(row.pay_rate.replace(/[$\s]/g, '')) : null;

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
        pay_rate: payRate !== null && Number.isFinite(payRate) ? payRate : null,
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
      let assignments = deptNames
        .map(n => deptMap.get(n))
        .filter(Boolean)
        .map(dept_id => ({ staff_id: staff.id, department_id: dept_id, training_level: 'trained' }));

      // No department named, or none of the named ones matched — fall back
      // to whichever department is flagged default, so this person doesn't
      // end up with zero departments just because the CSV column was empty.
      if (!assignments.length && defaultDeptId) {
        assignments = [{ staff_id: staff.id, department_id: defaultDeptId, training_level: 'trained' }];
      }

      if (assignments.length) {
        await supabase.from('staff_departments').insert(assignments);
      }
    }

    results.created++;
  }

  return NextResponse.json(results);
}
