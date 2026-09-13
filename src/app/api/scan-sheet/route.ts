import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { SHEET_DAYS, rowsToMatrix } from '@/lib/availabilitySheet';

/**
 * Reads a photo of the printed availability sheet and returns it as the same
 * grid a CSV upload produces, so the existing preview → confirm → apply sync
 * handles it unchanged.
 *
 * The transcription is never applied directly: /api/sync-staff-sheet previews
 * it first, which is what catches a misread digit before it reaches a staff
 * record.
 *
 * Everything here is shaped by one constraint — the hosting platform kills the
 * function at 60 seconds. The reply is kept small (short keys, blank days left
 * out), the model runs at low effort in fast mode, and the request carries its
 * own budget so a slow read returns a readable error instead of being cut off
 * mid-flight and replaced with an HTML error page.
 */

export const maxDuration = 60;

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5';
const FAST_MODE_BETA = 'fast-mode-2026-02-01';

/** Leaves ~13s of the platform's 60s for the rest of the request. */
const TOTAL_BUDGET_MS = 47_000;
/** Below this there is no point starting a second attempt. */
const MIN_RETRY_BUDGET_MS = 20_000;

/** Roughly 4.5 MB of base64 — beyond this the request is rejected upstream. */
const MAX_BASE64_LENGTH = 6_000_000;

const DAY_KEYS = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'] as const;
const CELL = { type: 'string' } as const;

/**
 * Short keys, and days omitted when the cell is blank. A sheet of ~28 people
 * has 196 day cells and most are empty, so this is the difference between a
 * reply that lands inside the time limit and one that does not.
 */
const SHEET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rows'],
  properties: {
    rows: {
      type: 'array',
      description: 'One entry per printed row, top to bottom.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['f', 'l', 'm'],
        properties: {
          f: { ...CELL, description: 'First name' },
          l: { ...CELL, description: 'Last name' },
          m: { ...CELL, description: 'Mobile number' },
          su: CELL, mo: CELL, tu: CELL, we: CELL, th: CELL, fr: CELL, sa: CELL,
        },
      },
    },
  },
} as const;

const INSTRUCTIONS = `This is a photograph of a printed staff availability sheet from a supermarket.

Transcribe it row by row, exactly as printed. Do not interpret, tidy or reformat anything.

Each printed row has a first name, a last name, a mobile number, then one cell per day from Sunday to Saturday. Return one object per row, in printed order: f = first name, l = last name, m = mobile, and su/mo/tu/we/th/fr/sa for the days.

Rules:
- Include every printed row, top to bottom.
- Section banner rows (the shaded "STORE" row, the "Juniors" / "-18" row) are not people. Return them with the banner text in f, the second label (if any) in l, m empty, and no day keys.
- A shift cell holds a time range written like "6AM-2PM", "4.30PM-9PM", "8AM - 5PM" or "11AM- 9PM". Copy the characters exactly, including the "." used for minutes. Never convert to 24-hour time.
- Omit a day key entirely when that cell is blacked out, greyed out or empty — that means the person is not available.
- Some cells hold a department name instead of a time, such as MEAT, NIGHTFILL, DAIRY/DELI or STORE/BAKERY. Copy that word as printed.
- Mobile numbers: copy every digit as printed, keeping any leading zero and the printed spacing.
- Accuracy matters more than completeness. If any character in a cell is not clearly legible, use "?" for that cell rather than guessing. Never invent a digit in a phone number or a time.`;

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

/** One attempt at the transcription, bounded by whatever budget is left. */
function transcribe(
  client: Anthropic,
  image: string,
  mediaType: ImageMediaType,
  options: { fast: boolean; timeoutMs: number }
) {
  return client.beta.messages
    .stream(
      {
        model: MODEL,
        max_tokens: 8000,
        ...(options.fast ? { speed: 'fast' as const, betas: [FAST_MODE_BETA] } : {}),
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: SHEET_SCHEMA as unknown as Record<string, unknown> },
        },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
              { type: 'text', text: INSTRUCTIONS },
            ],
          },
        ],
      },
      // One attempt per call: a retry inside the platform's time limit would
      // only guarantee that neither attempt finishes.
      { timeout: options.timeoutMs, maxRetries: 0 }
    )
    .finalMessage();
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'Photo reading is not set up — add ANTHROPIC_API_KEY to the deployment, then redeploy. Uploading the sheet as a CSV still works.' },
      { status: 501 }
    );
  }

  const body = await req.json().catch(() => null);
  const image: unknown = body?.image;
  const mediaType: string = body?.mediaType ?? 'image/jpeg';

  if (typeof image !== 'string' || !image) {
    return NextResponse.json({ error: 'No photo was received.' }, { status: 400 });
  }
  if (image.length > MAX_BASE64_LENGTH) {
    return NextResponse.json({ error: 'That photo is too large. Try again — the app shrinks photos before sending them.' }, { status: 413 });
  }
  if (mediaType !== 'image/jpeg' && mediaType !== 'image/png' && mediaType !== 'image/webp') {
    return NextResponse.json({ error: `Unsupported image type "${mediaType}".` }, { status: 400 });
  }

  const startedAt = Date.now();
  const budgetLeft = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);

  const client = new Anthropic();

  try {
    let message;
    try {
      message = await transcribe(client, image, mediaType, { fast: true, timeoutMs: budgetLeft() });
    } catch (err) {
      // Fast mode is a paid add-on and may not be enabled on the account; that
      // is rejected before any work is done, so there is time to try again.
      const rejectedFastMode =
        err instanceof Anthropic.BadRequestError && /speed|fast|beta/i.test(err.message);
      if (!rejectedFastMode || budgetLeft() < MIN_RETRY_BUDGET_MS) throw err;
      message = await transcribe(client, image, mediaType, { fast: false, timeoutMs: budgetLeft() });
    }

    if (message.stop_reason === 'refusal') {
      return NextResponse.json({ error: 'The photo could not be read. Try uploading the sheet as a CSV instead.' }, { status: 422 });
    }

    const text = message.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map(block => block.text)
      .join('');

    const parsed = JSON.parse(text) as { rows?: Record<string, string>[] };
    const rows = parsed.rows ?? [];
    if (!rows.length) {
      return NextResponse.json({ error: 'No rows could be read from that photo. Try again with the whole sheet in frame.' }, { status: 422 });
    }

    return NextResponse.json({
      rows: rowsToMatrix(rows.map(expandRow)),
      model: message.model,
      seconds: Math.round((Date.now() - startedAt) / 1000),
    });
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      return NextResponse.json(
        { error: 'Reading the sheet took too long and was stopped. Try again, or take the photo closer in so the text is sharper.' },
        { status: 504 }
      );
    }
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: 'The photo could not be turned into a sheet. Try again with a straighter, better-lit shot.' }, { status: 422 });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY was rejected — check the key set on the deployment.' }, { status: 502 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'Too many requests right now. Wait a moment and take the photo again.' }, { status: 429 });
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Could not read the photo (${err.status}): ${err.message}` }, { status: 502 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not read the photo.' },
      { status: 500 }
    );
  }
}

/** Put the short keys back into the names the sheet parser reads. */
function expandRow(row: Record<string, string>): Record<string, string> {
  const expanded: Record<string, string> = {
    first_name: row.f ?? '',
    last_name: row.l ?? '',
    mobile: row.m ?? '',
  };
  DAY_KEYS.forEach((key, day) => {
    expanded[SHEET_DAYS[day].toLowerCase()] = row[key] ?? '';
  });
  return expanded;
}
