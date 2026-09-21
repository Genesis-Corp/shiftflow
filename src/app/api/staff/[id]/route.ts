import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { toE164AU } from '@/lib/phone';
import { requireUser, unauthorized } from '@/lib/auth';

/** One staff member, with their trained departments (name + color, for the
 *  staff summary modal shown wherever their name is clicked). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { data, error } = await supabase
    .from('staff')
    .select(`
      *,
      staff_departments (
        id, department_id, training_level, is_default,
        departments ( id, name, color, requires_supervisor )
      )
    `)
    .eq('id', params.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: error.code === 'PGRST116' ? 404 : 500 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json();
  const { name, age_group, phone, active, birthday, employment_type, commencement_date, archived, sms_opt_out } = body;

  // Every field is applied only when the caller actually sent it — a partial
  // body (the Active/Inactive toggle and the archive actions send just one
  // field) must never blank out the rest. phone_e164 in particular used to
  // get computed unconditionally from `phone`, so any partial PATCH quietly
  // wiped it back to null even though `phone` itself was left untouched.
  //
  // role_type is deliberately not accepted here — it's never set by hand,
  // only recomputed from department training levels by
  // PUT /api/staff/[id]/departments.
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (age_group !== undefined) updates.age_group = age_group;
  if (phone !== undefined) { updates.phone = phone; updates.phone_e164 = toE164AU(phone); }
  if (active !== undefined) updates.active = active;
  if (birthday !== undefined) updates.birthday = birthday || null;
  if (employment_type !== undefined) updates.employment_type = employment_type || null;
  if (commencement_date !== undefined) updates.commencement_date = commencement_date || null;
  // A manager clearing this after a staff member texted STOP by mistake (or
  // wants back in without waiting on a START reply of their own) — set, not
  // computed, so it's a deliberate action rather than something a phone
  // field edit could silently flip.
  if (sms_opt_out !== undefined) updates.sms_opt_out = !!sms_opt_out;
  if (archived !== undefined) {
    updates.archived = archived;
    updates.archived_at = archived ? new Date().toISOString() : null;
    // Archived staff are never in rotation; reinstating puts them straight
    // back into it, matching "reinstate instantly" rather than leaving a
    // second step to flip Active back on.
    updates.active = !archived;
  }

  const { data, error } = await supabase
    .from('staff')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return unauthorized();

  // Remove department assignments first
  await supabase.from('staff_departments').delete().eq('staff_id', params.id);

  const { error } = await supabase.from('staff').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
