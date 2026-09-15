import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { searchParams } = new URL(req.url);
  const staff_id = searchParams.get('staff_id');

  let query = supabase.from('availability_templates').select('*').order('staff_id').order('day_of_week');
  if (staff_id) query = query.eq('staff_id', staff_id);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { staff_id, templates } = await req.json();
  // templates: Array<{ day_of_week, start_time, end_time, available }>
  if (!staff_id) return NextResponse.json({ error: 'staff_id required' }, { status: 400 });

  // Replace all templates for this staff member
  await supabase.from('availability_templates').delete().eq('staff_id', staff_id);

  if (!templates?.length) return NextResponse.json({ success: true });

  const rows = templates.map((t: { day_of_week: number; start_time: string; end_time: string; available: boolean }) => ({
    staff_id,
    day_of_week: t.day_of_week,
    start_time: t.start_time,
    end_time: t.end_time,
    available: t.available,
  }));

  const { data, error } = await supabase.from('availability_templates').insert(rows).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
