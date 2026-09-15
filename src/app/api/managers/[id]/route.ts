import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';

/** Revoke a manager's access. Can't remove your own account from here — do that from Supabase directly, so a solo manager can't lock themselves out by accident. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return unauthorized();

  if (params.id === user.id) {
    return NextResponse.json({ error: "You can't remove your own account." }, { status: 400 });
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
