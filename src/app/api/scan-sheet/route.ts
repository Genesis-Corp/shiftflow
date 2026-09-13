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
 */

export const maxDuration = 60;

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5';

/** Roughly 4.5 MB of base64 — beyond this the request is rejected upstream. */
const MAX_BASE64_LENGTH = 6_000_000;

const CELL = { type: 'string' } as const;

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
        required: ['first_name', 'last_name', 'mobile', ...SHEET_DAYS.map(d => d.toLowerCase())],
        properties: {
          first_name: CELL,
          last_name: CELL,
          mobile: CELL,
          sunday: CELL,
          monday: CELL,
          tuesday: CELL,
          wednesday: CELL,
          thursday: CELL,
          friday: CELL,
          saturday: CELL,
        },
      },
    },
  },
} as const;

const INSTRUCTIONS = `This is a photograph of a printed staff availability sheet from a supermarket.

Transcribe it row by row, exactly as printed. Do not interpret, tidy or reformat anything.

Columns: first name, last name, mobile number, then one column per day from Sunday to Saturday.

Rules:
- One entry per printed row, in the order they appear top to bottom.
- Section banner rows (for example the shaded "STORE" row, or the "Juniors" / "-18" row) are not people. Emit them with the banner text in first_name (and, where a second label like "-18" is printed, in last_name) and every other field empty.
- A shift cell holds a time range written like "6AM-2PM", "4.30PM-9PM", "8AM - 5PM" or "11AM- 9PM". Copy the characters exactly, including the "." used for minutes. Do not convert to 24-hour time.
- A blacked-out, greyed-out or empty cell means the person is not available: return "".
- Some cells hold a department name instead of a time, such as MEAT, NIGHTFILL, DAIRY/DELI or STORE/BAKERY. Copy that word as printed.
- Mobile numbers: copy every digit as printed, keeping any leading zero and the printed spacing.
- Accuracy matters more than completeness. If any character in a cell is not clearly legible, put "?" in that cell rather than guessing. Never invent a digit in a phone number or a time.`;

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'Photo capture is not set up — add ANTHROPIC_API_KEY to the deployment, then redeploy. Uploading the sheet as a CSV still works.' },
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

  const client = new Anthropic();

  try {
    const message = await client.messages
      .stream({
        model: MODEL,
        max_tokens: 16000,
        output_config: {
          effort: 'medium',
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
      })
      .finalMessage();

    if (message.stop_reason === 'refusal') {
      return NextResponse.json({ error: 'The photo could not be read. Try uploading the sheet as a CSV instead.' }, { status: 422 });
    }

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('');

    const parsed = JSON.parse(text) as { rows?: Record<string, string>[] };
    const rows = parsed.rows ?? [];
    if (!rows.length) {
      return NextResponse.json({ error: 'No rows could be read from that photo. Try again with the whole sheet in frame.' }, { status: 422 });
    }

    return NextResponse.json({ rows: rowsToMatrix(rows), model: message.model });
  } catch (err) {
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
