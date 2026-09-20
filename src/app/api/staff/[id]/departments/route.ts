import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';
import { computeRoleType } from '@/lib/roleType';
import { TrainingLevel } from '@/lib/types';

/** Replace all department assignments for a staff member. role_type is
 *  never set by hand — it's recomputed from the new training levels every
 *  time this runs, so it's always in sync with departments actually on file. */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { departments } = await req.json();
  // departments: Array<{ department_id: string; training_level: string; is_default?: boolean }>

  // Delete existing
  await supabase.from('staff_departments').delete().eq('staff_id', params.id);

  if (!departments?.length) {
    await supabase.from('staff').update({ role_type: computeRoleType([]) }).eq('id', params.id);
    return NextResponse.json({ success: true });
  }

  // Only one department can be default — if the caller marked more than one
  // (shouldn't happen, but the unique index would reject it), keep the first.
  let defaultSeen = false;
  const rows = departments.map((d: { department_id: string; training_level: TrainingLevel; is_default?: boolean }) => {
    const is_default = !!d.is_default && !defaultSeen;
    if (is_default) defaultSeen = true;
    return {
      staff_id: params.id,
      department_id: d.department_id,
      training_level: d.training_level ?? 'trained',
      is_default,
    };
  });

  const { data, error } = await supabase.from('staff_departments').insert(rows).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('staff').update({ role_type: computeRoleType(rows) }).eq('id', params.id);
  return NextResponse.json(data);
}
