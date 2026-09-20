import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { toE164AU } from '@/lib/phone';
import { requireUser, unauthorized } from '@/lib/auth';

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { data, error } = await supabase
    .from('staff')
    .select(`
      *,
      staff_departments (
        id, department_id, training_level, is_default,
        departments ( id, name, requires_supervisor )
      )
    `)
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json();
  const { name, age_group, phone, birthday, employment_type, commencement_date } = body;

  if (!name || !age_group)
    return NextResponse.json({ error: 'name and age_group are required' }, { status: 400 });

  // role_type is never set by hand — it starts as department_only and is
  // recomputed from actual training levels as soon as departments are
  // assigned (PUT /api/staff/[id]/departments).
  const { data, error } = await supabase
    .from('staff')
    .insert([{
      name, age_group, role_type: 'department_only',
      phone: phone ?? null,
      phone_e164: toE164AU(phone),
      birthday: birthday || null,
      employment_type: employment_type || null,
      commencement_date: commencement_date || null,
      reliability_score: 50, active: true,
    }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
