import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { RELIABILITY_DELTAS, applyReliabilityDelta } from '@/lib/shiftUtils';
import { requireUser, unauthorized } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { searchParams } = new URL(req.url);
  const staff_id = searchParams.get('staff_id');

  let query = supabase
    .from('reliability_incidents')
    .select(`*, staff ( id, name, age_group, role_type, reliability_score )`)
    .order('created_at', { ascending: false });

  if (staff_id) query = query.eq('staff_id', staff_id);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { staff_id, incident_type, shift_id, date, late_time, notes } = await req.json();
  if (!staff_id || !incident_type || !date)
    return NextResponse.json({ error: 'staff_id, incident_type, date required' }, { status: 400 });
  if (incident_type === 'late' && !late_time)
    return NextResponse.json({ error: 'late_time required for a Late incident' }, { status: 400 });

  // Record incident
  const { data: incident, error: incErr } = await supabase
    .from('reliability_incidents')
    .insert([{
      staff_id, incident_type, shift_id: shift_id ?? null, date,
      late_time: incident_type === 'late' ? late_time : null,
      notes: notes ?? null,
    }])
    .select()
    .single();
  if (incErr) return NextResponse.json({ error: incErr.message }, { status: 500 });

  // Update reliability score
  if ((RELIABILITY_DELTAS[incident_type] ?? 0) !== 0) {
    const { data: staff } = await supabase.from('staff').select('reliability_score').eq('id', staff_id).single();
    const newScore = applyReliabilityDelta(staff?.reliability_score ?? 50, incident_type);
    await supabase.from('staff').update({ reliability_score: newScore }).eq('id', staff_id);
  }

  return NextResponse.json(incident, { status: 201 });
}
