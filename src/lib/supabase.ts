import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const NOT_CONFIGURED =
  'The database is not connected — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in the deployment, then redeploy.';

/**
 * `createClient` throws when the URL is missing, which takes down every API
 * route with an unreadable 500 and leaves the pages white. Stand in for it with
 * a client whose queries resolve to a normal Supabase-shaped error instead, so
 * the deployment says what is wrong.
 */
function unconfiguredClient(): SupabaseClient {
  const result = { data: null, error: { message: NOT_CONFIGURED } };
  const chain: unknown = new Proxy(() => undefined, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
      }
      return () => chain;
    },
    apply() {
      return chain;
    },
  });
  return chain as SupabaseClient;
}

export const supabase: SupabaseClient = supabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : unconfiguredClient();
