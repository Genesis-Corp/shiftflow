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

export interface JsonResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

/**
 * POST JSON and always come back with something printable.
 *
 * A function that is killed mid-flight answers with the platform's own HTML
 * error page, not JSON, and calling `.json()` on that throws
 * "Unexpected token 'A'" at the user instead of saying what happened.
 */
export async function postJson<T>(
  url: string,
  body: unknown,
  options: { timeoutMs?: number } = {}
): Promise<JsonResult<T>> {
  const controller = new AbortController();
  const timer = options.timeoutMs ? setTimeout(() => controller.abort(), options.timeoutMs) : null;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null; // not JSON — an error page, most likely
    }

    const message = data && typeof data === 'object' && 'error' in data
      ? String((data as { error: unknown }).error)
      : null;

    if (!res.ok) return { ok: false, status: res.status, data: null, error: message ?? describeStatus(res.status, text) };
    if (data === null) return { ok: false, status: res.status, data: null, error: describeStatus(res.status, text) };

    return { ok: true, status: res.status, data: data as T, error: null };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, status: 0, data: null, error: 'That took too long and was stopped. Try again.' };
    }
    return { ok: false, status: 0, data: null, error: err instanceof Error ? err.message : `Could not reach ${url}` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function describeStatus(status: number, body: string): string {
  if (status === 504 || status === 408 || /timed out|timeout/i.test(body)) {
    return 'The server took too long and stopped at its 60 second limit. Try again, or upload the sheet as a CSV.';
  }
  if (status === 413) return 'That file was too large to send.';
  if (status === 502 || status === 503) return 'The server is unavailable right now. Try again in a moment.';

  const snippet = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return snippet
    ? `Unexpected response from the server (${status}): ${snippet}`
    : `Unexpected response from the server (${status}).`;
}
