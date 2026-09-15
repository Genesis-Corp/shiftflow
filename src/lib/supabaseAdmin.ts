import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase client using the service-role key.
 *
 * This key bypasses Row Level Security, so it must NEVER be imported into a
 * file that runs in the browser. Do not import this module from any file
 * carrying the 'use client' directive.
 *
 * All API routes use this client. The anon client in `supabase.ts` is locked
 * out of every table by RLS (see supabase-claim-race.sql).
 *
 * The client is created lazily on first use rather than at import time: route
 * modules are loaded during `next build`, where the secret is absent, and a
 * module-scope throw would fail the build rather than the request.
 */

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Add it in Vercel → Settings → ' +
      'Environment Variables (and .env.local for development), then redeploy. ' +
      'It must NOT be prefixed with NEXT_PUBLIC_.'
    );
  }

  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});
