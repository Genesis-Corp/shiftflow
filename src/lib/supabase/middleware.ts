import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Paths reachable without a signed-in session.
 *
 * '/login' obviously needs to be — you can't log in from behind a login wall.
 * '/api/sms/inbound' is Twilio's webhook: it has no user, no cookies, no
 * browser involved, and is verified instead by its own HMAC signature check
 * (validateTwilioSignature). '/api/auth/*' are the login/bootstrap endpoints
 * themselves, which run before a session exists.
 */
const PUBLIC_PATHS = ['/login', '/api/sms/inbound', '/api/auth'];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

/**
 * API routes must never receive a redirect here. A 307 to /login is fine for
 * a browser navigating to a page, but fetch() on the client follows redirects
 * by default and would silently receive the login page's HTML with status
 * 200 instead of the 401 the route would have returned — fetchJson() (and
 * every page built on it) has no way to detect that as a failure. Every
 * protected API route already calls requireUser() itself and returns a clean
 * 401 JSON body, so for /api/* this just refreshes the cookie and steps
 * aside; the route's own check is the real gate.
 */
export function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

/**
 * Runs on every request. Refreshes the Supabase session cookie (access
 * tokens expire; this is what keeps a signed-in user signed in) and redirects
 * to /login when there is no session and the path isn't public.
 *
 * This is the first of two checks, not the only one — see requireUser() in
 * src/lib/auth.ts. Middleware protects the pages a person clicks through;
 * each API route separately verifies the session too, so a request crafted
 * to hit /api/staff directly (curl, not the browser) is still refused even if
 * a bug ever let it slip past middleware.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() (not getSession()) — it revalidates against Supabase Auth
  // rather than trusting the cookie's claims unchecked.
  const { data: { user } } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname) && !isApiPath(request.nextUrl.pathname)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
