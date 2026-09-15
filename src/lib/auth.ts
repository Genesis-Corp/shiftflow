import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface SessionUser {
  id: string;
  email: string;
}

/**
 * Server-side session check for API routes.
 *
 * Middleware already redirects an unauthenticated browser to /login, but that
 * is a UX convenience, not the security boundary — middleware can be
 * misconfigured, and nothing stops a direct request (curl, a script, the
 * anon key extracted from the bundle) from hitting an API route straight.
 * Every route that touches staff/shift/reliability data calls this itself,
 * so the check holds regardless of how the request arrived.
 */
export async function requireUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return null;
  return { id: user.id, email: user.email };
}

/** 401 response for a route handler to return when requireUser() finds nobody. */
export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
}
