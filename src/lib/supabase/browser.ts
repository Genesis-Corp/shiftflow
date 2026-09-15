'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Supabase client for Client Components (the login form, the sign-out
 * button). Session state is stored in cookies (not localStorage), which is
 * what lets the server — middleware, Route Handlers — see the same session
 * the browser does.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
