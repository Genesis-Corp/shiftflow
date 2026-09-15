import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { toE164AU } from '@/lib/phone';

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

  const { data, error } = await supabase
    .from('staff')
    .insert([{
      name, age_group, role_type,
      phone: phone ?? null,
      phone_e164: toE164AU(phone),
      reliability_score: 50, active: true,
    }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
