import { NextRequest, NextResponse } from 'next/server';
import { SHEET_DAYS, rowsToMatrix } from '@/lib/availabilitySheet';
import { readImage, readImageRequest, readPdf, readPdfRequest, visionErrorResponse } from '@/lib/vision';
import { requireUser, unauthorized } from '@/lib/auth';

/**
 * Reads a photo — or, now, a PDF — of the printed availability sheet and
 * returns it as the same grid a CSV upload produces, so the existing
 * preview → confirm → apply sync handles it unchanged.
 *
 * The transcription is never applied directly: /api/sync-staff-sheet previews
 * it first, which is what catches a misread digit before it reaches a staff
 * record.
 */

export const maxDuration = 60;

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
};

function instructionsFor(kind: 'photograph' | 'PDF'): string {
  return `This is a ${kind === 'photograph' ? 'photograph' : 'PDF'} of a printed staff availability sheet from a supermarket.

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
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const isPdf = !!(body && typeof body === 'object' && 'pdf' in body);

  try {
    const { data, seconds, model } = isPdf
      ? await readFromPdf(body)
      : await readFromImage(body);

    const rows = data.rows ?? [];
    if (!rows.length) {
      return NextResponse.json({ error: 'No rows could be read from that file. Try again with the whole sheet in frame.' }, { status: 422 });
    }

    return NextResponse.json({ rows: rowsToMatrix(rows.map(expandRow)), model, seconds });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    return visionErrorResponse(err, isPdf ? 'PDF' : 'sheet');
  }
}

async function readFromImage(body: unknown) {
  const request = readImageRequest(body);
  if (request instanceof NextResponse) throw request;
  return readImage<{ rows?: Record<string, string>[] }>(request, instructionsFor('photograph'), SHEET_SCHEMA);
}

async function readFromPdf(body: unknown) {
  const request = readPdfRequest(body);
  if (request instanceof NextResponse) throw request;
  return readPdf<{ rows?: Record<string, string>[] }>(request, instructionsFor('PDF'), SHEET_SCHEMA);
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
