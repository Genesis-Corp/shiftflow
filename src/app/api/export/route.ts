import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') ?? 'staff';

  if (type === 'staff') {
    const { data, error } = await supabase
      .from('staff')
      .select(`*, staff_departments ( departments ( name ) )`)
      .order('name');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (data ?? []).map((s: {
      name: string; age_group: string; role_type: string;
      reliability_score: number; active: boolean; phone?: string;
      staff_departments: { departments: { name: string } }[];
    }) => ({
      name: s.name,
      age_group: s.age_group,
      role_type: s.role_type,
      reliability_score: s.reliability_score,
      active: s.active,
      phone: s.phone ?? '',
      departments: s.staff_departments.map(d => d.departments?.name ?? '').filter(Boolean).join(', '),
    }));

    return NextResponse.json({ rows, filename: 'staff-export.csv' });
  }

  if (type === 'shifts') {
    const { data, error } = await supabase
      .from('shifts')
      .select(`*, departments ( name ), assigned_staff:staff ( name )`)
      .order('date').order('start_time');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (data ?? []).map((s: {
      date: string; start_time: string; end_time: string;
      status: string; has_break: boolean; break_duration_minutes: number; notes?: string;
      departments: { name: string }; assigned_staff?: { name: string };
    }) => ({
      date: s.date,
      start_time: s.start_time,
      end_time: s.end_time,
      department: s.departments?.name ?? '',
      status: s.status,
      assigned_to: s.assigned_staff?.name ?? '',
      has_break: s.has_break,
      break_minutes: s.break_duration_minutes,
      notes: s.notes ?? '',
    }));

    return NextResponse.json({ rows, filename: 'shifts-export.csv' });
  }

  return NextResponse.json({ error: 'type must be staff or shifts' }, { status: 400 });
}
