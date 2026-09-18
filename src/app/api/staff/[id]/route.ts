import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { toE164AU } from '@/lib/phone';
import { requireUser, unauthorized } from '@/lib/auth';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json();
  const { name, age_group, role_type, phone, active, birthday, employment_type, commencement_date, archived } = body;

  // Every field is applied only when the caller actually sent it — a partial
  // body (the Active/Inactive toggle and the archive actions send just one
  // field) must never blank out the rest. phone_e164 in particular used to
  // get computed unconditionally from `phone`, so any partial PATCH quietly
  // wiped it back to null even though `phone` itself was left untouched.
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (age_group !== undefined) updates.age_group = age_group;
  if (role_type !== undefined) updates.role_type = role_type;
  if (phone !== undefined) { updates.phone = phone; updates.phone_e164 = toE164AU(phone); }
  if (active !== undefined) updates.active = active;
  if (birthday !== undefined) updates.birthday = birthday || null;
  if (employment_type !== undefined) updates.employment_type = employment_type || null;
  if (commencement_date !== undefined) updates.commencement_date = commencement_date || null;
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
