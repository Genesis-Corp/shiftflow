import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/** Replace all department assignments for a staff member */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { departments } = await req.json();
  // departments: Array<{ department_id: string; training_level: string }>

  // Delete existing
  await supabase.from('staff_departments').delete().eq('staff_id', params.id);

  if (!departments?.length) return NextResponse.json({ success: true });

  const rows = departments.map((d: { department_id: string; training_level: string }) => ({
    staff_id: params.id,
    department_id: d.department_id,
    training_level: d.training_level ?? 'trained',
  }));

  const { data, error } = await supabase.from('staff_departments').insert(rows).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
