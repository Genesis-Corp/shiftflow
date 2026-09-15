/**
 * Shared fetch helper for client components.
 *
 * The bug this exists to prevent: every page used to do
 * `setStaff(await res.json())` with no check on res.ok. If an API route
 * throws (e.g. SUPABASE_SERVICE_ROLE_KEY missing on that Vercel environment),
 * Next.js returns an HTML error page instead of JSON, res.json() throws, the
 * throw is never caught, and the page silently renders an empty list. That
 * looks exactly like "all the data is gone" when nothing was touched.
 *
 * fetchJson makes a bad response into a real Error with the server's message,
 * so callers can show it instead of quietly rendering nothing.
 */
export async function fetchJson<T = unknown>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // Response wasn't JSON at all (e.g. Next.js's own HTML error page) —
      // the status text above is the best we can do.
    }
    throw new Error(message);
  }

  return res.json();
}
