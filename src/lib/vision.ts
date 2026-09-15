import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

/**
 * Shared plumbing for reading a photo, screenshot or PDF into structured data.
 *
 * Shaped by the hosting platform's 60-second function limit: the request
 * carries its own budget so a slow read returns a readable error rather than
 * being killed mid-flight and replaced with an HTML error page.
 */

export const VISION_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

const FAST_MODE_BETA = 'fast-mode-2026-02-01';

/**
 * Fast mode only exists on the Opus 5 / 4.8 models, and it has its own rate
 * limit separate from standard capacity — so it is used only when the chosen
 * model supports it, and dropped on the first sign that it is unavailable.
 */
const FAST_MODE_MODELS = /^claude-opus-(5|4-8)\b/;

/** Leaves ~13s of the platform's 60s for the rest of the request. */
const TOTAL_BUDGET_MS = 47_000;
/** Below this there is no point starting a second attempt. */
const MIN_RETRY_BUDGET_MS = 20_000;

/** Roughly 4.5 MB of base64 — beyond this the request is rejected upstream. */
export const MAX_BASE64_LENGTH = 6_000_000;

/**
 * The Messages API accepts a 32 MB request and up to 600 PDF pages (100 for
 * 200k-context models — not a limit that applies here, since the model this
 * app uses has a 1M window). Base64 inflates raw bytes by ~4/3, so this caps
 * the base64 string at roughly what a 21 MB PDF produces, leaving headroom
 * in the 32 MB ceiling for the rest of the JSON body.
 */
export const MAX_PDF_BASE64_LENGTH = 28_000_000;

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImageRequest {
  image: string;
  mediaType: ImageMediaType;
}

export interface PdfRequest {
  pdf: string;
}

/** Check an incoming image payload; returns a response to send back, or the image. */
export function readImageRequest(body: unknown): NextResponse | ImageRequest {
  const keyCheck = requireApiKey();
  if (keyCheck) return keyCheck;

  const payload = (body ?? {}) as { image?: unknown; mediaType?: unknown };
  const image = payload.image;
  const mediaType = typeof payload.mediaType === 'string' ? payload.mediaType : 'image/jpeg';

  if (typeof image !== 'string' || !image) {
    return NextResponse.json({ error: 'No photo was received.' }, { status: 400 });
  }
  if (image.length > MAX_BASE64_LENGTH) {
    return NextResponse.json({ error: 'That photo is too large. Try again — the app shrinks photos before sending them.' }, { status: 413 });
  }
  if (mediaType !== 'image/jpeg' && mediaType !== 'image/png' && mediaType !== 'image/webp') {
    return NextResponse.json({ error: `Unsupported image type "${mediaType}".` }, { status: 400 });
  }

  return { image, mediaType };
}

/** Check an incoming PDF payload; returns a response to send back, or the PDF. */
export function readPdfRequest(body: unknown): NextResponse | PdfRequest {
  const keyCheck = requireApiKey();
  if (keyCheck) return keyCheck;

  const payload = (body ?? {}) as { pdf?: unknown };
  const pdf = payload.pdf;

  if (typeof pdf !== 'string' || !pdf) {
    return NextResponse.json({ error: 'No PDF was received.' }, { status: 400 });
  }
  if (pdf.length > MAX_PDF_BASE64_LENGTH) {
    return NextResponse.json({ error: 'That PDF is too large — try exporting a shorter one, or upload a CSV instead.' }, { status: 413 });
  }

  return { pdf };
}

function requireApiKey(): NextResponse | null {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'Photo reading is not set up — add ANTHROPIC_API_KEY to the deployment, then redeploy.' },
      { status: 501 }
    );
  }
  return null;
}

class RefusedError extends Error {}

type SourceBlock =
  | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

/** Shared call: build the request around whichever source block the caller supplies. */
async function readSource<T>(
  block: SourceBlock,
  instructions: string,
  schema: Record<string, unknown>
): Promise<{ data: T; seconds: number; model: string }> {
  const startedAt = Date.now();
  const budgetLeft = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);

  const client = new Anthropic();
  const fastMode = FAST_MODE_MODELS.test(VISION_MODEL);

  const attempt = (fast: boolean) =>
    client.beta.messages
      .stream(
        {
          model: VISION_MODEL,
          max_tokens: 8000,
          ...(fast ? { speed: 'fast' as const, betas: [FAST_MODE_BETA] } : {}),
          output_config: { effort: 'low', format: { type: 'json_schema', schema } },
          messages: [
            {
              role: 'user',
              content: [
                block,
                { type: 'text', text: instructions },
              ],
            },
          ],
        },
        // One attempt per call: a retry inside the platform's time limit would
        // only guarantee that neither attempt finishes.
        { timeout: budgetLeft(), maxRetries: 0 }
      )
      .finalMessage();

  let message;
  try {
    message = await attempt(fastMode);
  } catch (err) {
    // Fast mode can be unavailable on the account, or busy on its own rate
    // limit. Both are answered before any work is done, so there is time to
    // fall back to standard capacity rather than fail the upload.
    const fastModeUnavailable =
      fastMode &&
      ((err instanceof Anthropic.BadRequestError && /speed|fast|beta/i.test(err.message)) ||
        err instanceof Anthropic.RateLimitError);
    if (!fastModeUnavailable || budgetLeft() < MIN_RETRY_BUDGET_MS) throw err;
    message = await attempt(false);
  }

  if (message.stop_reason === 'refusal') throw new RefusedError();

  const text = message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');

  return {
    data: JSON.parse(text) as T,
    seconds: Math.round((Date.now() - startedAt) / 1000),
    model: message.model,
  };
}

/** Read an image into whatever shape the schema describes. */
export function readImage<T>(
  request: ImageRequest,
  instructions: string,
  schema: Record<string, unknown>
): Promise<{ data: T; seconds: number; model: string }> {
  return readSource<T>(
    { type: 'image', source: { type: 'base64', media_type: request.mediaType, data: request.image } },
    instructions,
    schema
  );
}

/**
 * Read a PDF into whatever shape the schema describes — same structured-output
 * pipeline as readImage, just a document content block instead of an image
 * one. No beta header is needed for a base64 PDF; the json_schema and
 * fast-mode betas above are unaffected by which block type carries the source.
 */
export function readPdf<T>(
  request: PdfRequest,
  instructions: string,
  schema: Record<string, unknown>
): Promise<{ data: T; seconds: number; model: string }> {
  return readSource<T>(
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: request.pdf } },
    instructions,
    schema
  );
}

/** Turn a failed read into a response that says what to do about it. */
export function visionErrorResponse(err: unknown, subject = 'photo'): NextResponse {
  if (err instanceof RefusedError) {
    return NextResponse.json({ error: `The ${subject} could not be read. Try a clearer shot.` }, { status: 422 });
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return NextResponse.json(
      { error: `Reading the ${subject} took too long and was stopped. Try again, or take the photo closer in so the text is sharper.` },
      { status: 504 }
    );
  }
  if (err instanceof SyntaxError) {
    return NextResponse.json({ error: `The ${subject} could not be turned into data. Try again with a straighter, better-lit shot.` }, { status: 422 });
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY was rejected — check the key set on the deployment.' }, { status: 502 });
  }
  if (err instanceof Anthropic.RateLimitError) {
    const retryAfter = err.headers?.get?.('retry-after');
    const wait = retryAfter ? `Try again in about ${retryAfter} seconds.` : 'Wait a minute and try again.';
    return NextResponse.json(
      { error: `${VISION_MODEL} is rate limited on this account. ${wait}` },
      { status: 429 }
    );
  }
  if (err instanceof Anthropic.APIError) {
    return NextResponse.json({ error: `Could not read the ${subject} (${err.status}): ${err.message}` }, { status: 502 });
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : `Could not read the ${subject}.` },
    { status: 500 }
  );
}
