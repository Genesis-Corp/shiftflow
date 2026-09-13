import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { syncStaffSheet } from '@/lib/staffSync';
import { isAvailabilitySheet } from '@/lib/availabilitySheet';

// ── Standard staff CSV format ─────────────────────────────────────────────────
interface StandardRow {
  name?: string;
  age_group?: string;
  role_type?: string;
  phone?: string;
  departments?: string;
}

/** Rebuild the raw grid from parsed row objects so the sheet parser can read it. */
function objectsToMatrix(rows: Record<string, string>[]): string[][] {
  const headers = Object.keys(rows[0] ?? {});
  return [headers, ...rows.map(row => headers.map(h => row[h] ?? ''))];
}

export async function POST(req: NextRequest) {
  const { rows }: { rows: Record<string, string>[] } = await req.json();
  if (!rows?.length) return NextResponse.json({ error: 'No rows provided' }, { status: 400 });

  // ── Availability sheet ─────────────────────────────────────────────────────
  // Handled by the sheet sync so a re-upload updates in place instead of
  // duplicating everyone. Staff missing from the sheet are left alone here —
  // removing them is only done from /api/sync-staff-sheet, which previews the
  // deletions first.
  const matrix = objectsToMatrix(rows);
  if (isAvailabilitySheet(matrix)) {
    const plan = await syncStaffSheet(matrix, { mode: 'apply', deleteMissing: false });
    return NextResponse.json({
      created: plan.applied?.staff_created ?? 0,
      updated: plan.updates.length,
      unchanged: plan.unchanged.length,
      errors: plan.errors,
      warnings: plan.warnings,
    });
  }

  const { data: departments } = await supabase.from('departments').select('id, name');
  const deptMap = new Map(
    (departments ?? []).map((d: { id: string; name: string }) => [d.name.toLowerCase().trim(), d.id])
  );

  const results = { created: 0, errors: [] as string[] };

  // ── Standard format ────────────────────────────────────────────────────────
  for (const row of rows as unknown as StandardRow[]) {
    if (!row.name || !row.age_group || !row.role_type) {
      results.errors.push(`Skipped row (missing fields): ${JSON.stringify(row)}`);
      continue;
    }

    const { data: staff, error } = await supabase
      .from('staff')
      .insert([{
        name: row.name.trim(),
        age_group: row.age_group.toLowerCase().trim(),
        role_type: row.role_type.toLowerCase().replace(/\s+/g, '_').trim(),
        phone: row.phone?.trim() ?? null,
        reliability_score: 50,
        active: true,
      }])
      .select()
      .single();

    if (error) {
      results.errors.push(`Failed to import "${row.name}": ${error.message}`);
      continue;
    }

    if (row.departments && staff) {
      const deptNames = row.departments.split(',').map(n => n.trim().toLowerCase());
      const assignments = deptNames
        .map(n => deptMap.get(n))
        .filter(Boolean)
        .map(dept_id => ({ staff_id: staff.id, department_id: dept_id, training_level: 'trained' }));

      if (assignments.length) {
        await supabase.from('staff_departments').insert(assignments);
      }
    }

    results.created++;
  }

  return NextResponse.json(results);
}
