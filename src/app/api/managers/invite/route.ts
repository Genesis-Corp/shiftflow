import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Invite a new manager. Only a signed-in manager can do this — there is no
 * public sign-up. Supabase emails the invitee a link that lets them set their
 * own password; nobody's password passes through this app or this chat.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { email } = await req.json();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  // Without an explicit redirectTo, Supabase falls back to the project's
  // Site URL — easy to leave pointed at an old domain, and even when it's
  // right there was previously nowhere for the link to land at all (no
  // /auth/callback existed). This still requires the URL below to be on the
  // Supabase project's Redirect URLs allowlist (Auth settings), or Supabase
  // silently falls back to the Site URL anyway.
  const origin = new URL(req.url).origin;
  const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/auth/callback`,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true }, { status: 201 });
}
