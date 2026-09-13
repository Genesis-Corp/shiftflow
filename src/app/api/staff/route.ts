import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { withNameParts } from '@/lib/staffNames';

export async function GET() {
  const { data, error } = await supabase
    .from('staff')
    .select(`
      *,
      staff_departments (
        id, department_id, training_level,
        departments ( id, name, requires_supervisor )
      )
    `)
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, age_group, role_type, phone } = body;

  if (!name || !age_group || !role_type)
    return NextResponse.json({ error: 'name, age_group and role_type are required' }, { status: 400 });

  const payload = await withNameParts(
    { name, age_group, role_type, phone: phone ?? null, reliability_score: 50, active: true },
    name
  );

  const { data, error } = await supabase
    .from('staff')
    .insert([payload])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
