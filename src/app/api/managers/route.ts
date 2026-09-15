import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** List existing manager accounts. Requires a signed-in manager. */
export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { data, error } = await supabaseAdmin.auth.admin.listUsers();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    data.users
      .map(u => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        invited: !u.last_sign_in_at,
      }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
  );
}
