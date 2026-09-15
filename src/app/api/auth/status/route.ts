import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

/**
 * Public (no requireUser — there may be nobody to require yet). Tells the
 * login page whether to show "sign in" or "set up the first account", without
 * exposing anything about who those accounts belong to.
 */
export async function GET() {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ hasUsers: data.users.length > 0 });
}
