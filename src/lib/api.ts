/**
 * Client-side fetch helpers.
 *
 * The API routes answer with `{ error: "..." }` when something goes wrong, so
 * assigning a response straight into list state (`setStaff(await res.json())`)
 * puts an object where the page expects an array and the next `.map()` takes
 * the whole page down with "a client-side exception has occurred". These
 * helpers always hand back an array plus a message to show.
 */

export interface ListResult<T> {
  data: T[];
  error: string | null;
}

export async function fetchList<T>(url: string): Promise<ListResult<T>> {
  try {
    const res = await fetch(url);
    const body = await res.json().catch(() => null);

    if (!res.ok) {
      return { data: [], error: describe(body, `${url} responded with ${res.status}`) };
    }
    if (!Array.isArray(body)) {
      return { data: [], error: describe(body, `${url} returned an unexpected response`) };
    }
    return { data: body as T[], error: null };
  } catch (err) {
    return { data: [], error: err instanceof Error ? err.message : `Could not reach ${url}` };
  }
}

function describe(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const message = (body as { error: unknown }).error;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}
