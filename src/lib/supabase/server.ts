import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client for Server Components and Route Handlers, backed by the
 * request's cookies rather than the service-role key. Used to answer "who is
 * signed in right now" — session checks, not data access. Data access still
 * goes through supabaseAdmin (service role), which this file never touches.
 *
 * Must be created fresh per request (Next.js's `cookies()` is request-scoped),
 * so this is a factory, not a singleton like supabaseAdmin.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component, which can't set cookies — safe
            // to ignore because middleware refreshes the session on every
            // request anyway. Only Route Handlers and Server Actions need
            // this to actually take effect.
          }
        },
      },
    }
  );
}
