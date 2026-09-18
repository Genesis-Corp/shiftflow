import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';
import { autoDeptColor } from '@/lib/deptColors';

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { data, error } = await supabase
    .from('departments')
    .select('*')
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { name, requires_supervisor, color } = await req.json();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const { count } = await supabase.from('departments').select('id', { count: 'exact', head: true });

  const { data, error } = await supabase
    .from('departments')
    .insert([{
      name, requires_supervisor: requires_supervisor ?? false,
      color: color ?? autoDeptColor(count ?? 0),
    }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
