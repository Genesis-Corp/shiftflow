import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requiresBreak, BREAK_DURATION_MINUTES } from '@/lib/shiftUtils';

interface ShiftRow {
  date?: string;
  start_time?: string;
  end_time?: string;
  department?: string;
  required_role?: string;
  notes?: string;
}

/** Normalise "09:00:00" or "9:00" → "09:00" */
function normaliseTime(t: string): string {
  const parts = t.trim().split(':');
  const h = String(parseInt(parts[0])).padStart(2, '0');
  const m = String(parseInt(parts[1] ?? '0')).padStart(2, '0');
  return `${h}:${m}`;
}

export async function POST(req: NextRequest) {
  const { rows }: { rows: ShiftRow[] } = await req.json();
  if (!rows?.length) return NextResponse.json({ error: 'No rows provided' }, { status: 400 });

  const { data: departments } = await supabase.from('departments').select('id, name');
  const deptMap = new Map(
    (departments ?? []).map((d: { id: string; name: string }) => [d.name.toLowerCase().trim(), d.id])
  );

  const results = { created: 0, skipped: 0, errors: [] as string[] };

  for (const row of rows) {
    const { date, department, notes } = row;
    const rawStart = row.start_time;
    const rawEnd = row.end_time;

    if (!date || !rawStart || !rawEnd || !department) {
      results.errors.push(`Skipped row (missing date/start_time/end_time/department): ${JSON.stringify(row)}`);
      results.skipped++;
      continue;
    }

    const deptId = deptMap.get(department.toLowerCase().trim());
    if (!deptId) {
      results.errors.push(`Unknown department "${department}" — skipped row for ${date}`);
      results.skipped++;
      continue;
    }

    const start_time = normaliseTime(rawStart);
    const end_time = normaliseTime(rawEnd);

    const requiredRole = row.required_role?.toLowerCase().trim();
    const required_role =
      requiredRole === 'senior' || requiredRole === 'junior' ? requiredRole : 'any';

    const has_break = requiresBreak(start_time, end_time);

    const { error } = await supabase.from('shifts').insert([{
      date,
      start_time,
      end_time,
      department_id: deptId,
      required_role,
      status: 'open',
      has_break,
      break_duration_minutes: has_break ? BREAK_DURATION_MINUTES : 0,
      notes: notes?.trim() || null,
    }]);

    if (error) {
      results.errors.push(`Failed to import shift on ${date}: ${error.message}`);
    } else {
      results.created++;
    }
  }

  return NextResponse.json(results);
}
