import { timingSafeEqual } from 'crypto';
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

/**
 * Bearer-token check for server-to-server automation routes — there is no
 * browser session to ask Supabase Auth about, since the caller is a script,
 * not a manager. AUTOMATION_TOKEN unset means the route stays off rather
 * than open: no token configured, no requests accepted.
 */
export function requireAutomationToken(req: Request): boolean {
  const configured = process.env.AUTOMATION_TOKEN?.trim();
  if (!configured) return false;

  const header = req.headers.get('authorization') ?? '';
  const provided = header.replace(/^Bearer\s+/i, '').trim();
  if (!provided) return false;

  const a = Buffer.from(configured);
  const b = Buffer.from(provided);
  // timingSafeEqual throws on a length mismatch rather than returning false,
  // so that has to be ruled out first — doing so on the raw strings, before
  // any Buffer is made from untrusted input, keeps the comparison itself
  // constant-time for same-length input.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** 401 response for a route handler to return when requireAutomationToken() fails. */
export function automationUnauthorized(): NextResponse {
  return NextResponse.json({ error: 'Missing or invalid automation token' }, { status: 401 });
}
