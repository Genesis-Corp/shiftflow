import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

/**
 * Create the very first account. Deliberately not behind requireUser() — by
 * definition nobody can be signed in yet. Safe anyway because it works
 * exactly once: it refuses the moment any account already exists, checked
 * fresh against Supabase Auth on every call, not cached. After the first
 * manager is created, every subsequent one goes through /api/managers/invite
 * instead, which does require a signed-in manager.
 */
export async function POST(req: NextRequest) {
  const { data: existing, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });

  if (existing.users.length > 0) {
    return NextResponse.json(
      { error: 'An account already exists. Ask an existing manager to invite you from the Managers page.' },
      { status: 403 }
    );
  }

  const { email, password } = await req.json();
  if (!email || !password) {
    return NextResponse.json({ error: 'email and password required' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  const { error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });

  return NextResponse.json({ ok: true }, { status: 201 });
}
