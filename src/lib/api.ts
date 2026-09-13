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

/**
 * Statuses worth trying again: the request never really got anywhere, or the
 * far end was briefly unwell. A 400 or a 404 will say the same thing twice.
 */
function worthRetrying(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

const RETRY_DELAY_MS = 700;

/**
 * Read a list endpoint, retrying once on a transient failure.
 *
 * A phone on mobile data drops requests, and a sleepy database answers the
 * first query of the day with a gateway timeout — both recover on their own a
 * second later. Only GETs are retried: repeating a write could apply it twice.
 */
export async function fetchList<T>(url: string, attemptsLeft = 1): Promise<ListResult<T>> {
  const retry = async (): Promise<ListResult<T> | null> => {
    if (attemptsLeft <= 0) return null;
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    return fetchList<T>(url, attemptsLeft - 1);
  };

  try {
    const res = await fetch(url, { cache: 'no-store' });
    const body = await res.json().catch(() => null);

    if (!res.ok) {
      if (worthRetrying(res.status)) {
        const again = await retry();
        if (again) return again;
      }
      return { data: [], error: describe(body, `${url} responded with ${res.status}`) };
    }
    if (!Array.isArray(body)) {
      return { data: [], error: describe(body, `${url} returned an unexpected response`) };
    }
    return { data: body as T[], error: null };
  } catch (err) {
    const again = await retry(); // the request never landed — that is the most retryable failure there is
    if (again) return again;
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
