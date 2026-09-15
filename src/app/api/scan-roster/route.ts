import { NextRequest, NextResponse } from 'next/server';
import { parseRoster, ScannedRosterRow } from '@/lib/roster';
import { readImage, readImageRequest, readPdf, readPdfRequest, visionErrorResponse } from '@/lib/vision';
import { requireUser, unauthorized } from '@/lib/auth';

/**
 * Reads a screenshot — or a PDF export — of one day's roster: a person per
 * row with the hours they are on. Returns it as entries the Shifts page can
 * preview before anything is written.
 *
 * The source rarely carries a date, so the date is chosen in the app; only a
 * date actually printed on the source itself is reported here.
 */

export const maxDuration = 60;

const TEXT = { type: 'string' } as const;

const ROSTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rows'],
  properties: {
    dept: { ...TEXT, description: 'The heading naming the department or area, if shown.' },
    date: { ...TEXT, description: 'Only if a date is printed on the source, as YYYY-MM-DD.' },
    rows: {
      type: 'array',
      description: 'One entry per person listed, top to bottom.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['n', 's', 'e'],
        properties: {
          n: { ...TEXT, description: 'Name as shown, including a trailing ellipsis if it is cut off.' },
          s: { ...TEXT, description: 'Rostered start time.' },
          e: { ...TEXT, description: 'Rostered end time.' },
          st: { ...TEXT, description: 'Status chip, if one is shown.' },
        },
      },
    },
  },
};

function instructionsFor(kind: 'screenshot' | 'PDF'): string {
  return `This is a ${kind === 'screenshot' ? 'screenshot' : 'PDF export'} from a staff rostering app, showing one day's roster for one department or area.

Read it row by row, exactly as shown.

For each person listed return:
- n: their name exactly as displayed. If the app has cut the name off, keep the ellipsis (for example "Md Mozammal…") rather than guessing the rest.
- s and e: the rostered start and end time for that person, from the "Rostered time" line (for example "11:00 - 18:00" means s is "11:00" and e is "18:00"). Copy the digits as shown and do not convert between 12- and 24-hour time.
- st: the status shown against them, if any — for example Working, Finished, No show, Late start, Waiting for start.

Also return:
- dept: the heading naming the department or area, such as the title at the top of the screen or page.
- date: only if an actual date is printed somewhere. Leave it out otherwise — do not infer one.

Ignore employee numbers in brackets, job titles, site names, and buttons such as Call or Replace.

If a time is not clearly legible, use "?" rather than guessing.`;
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

    const { entries, warnings } = parseRoster(data.rows ?? []);
    if (!entries.length) {
      return NextResponse.json(
        { error: `No rostered people could be read from that ${isPdf ? 'PDF' : 'screenshot'}. Try again with the whole list in frame.` },
        { status: 422 }
      );
    }

    return NextResponse.json({
      department: data.dept ?? null,
      date: data.date ?? null,
      entries,
      warnings,
      model,
      seconds,
    });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    return visionErrorResponse(err, isPdf ? 'PDF' : 'screenshot');
  }
}

async function readFromImage(body: unknown) {
  const request = readImageRequest(body);
  if (request instanceof NextResponse) throw request;
  return readImage<{ dept?: string; date?: string; rows?: ScannedRosterRow[] }>(
    request, instructionsFor('screenshot'), ROSTER_SCHEMA
  );
}

async function readFromPdf(body: unknown) {
  const request = readPdfRequest(body);
  if (request instanceof NextResponse) throw request;
  return readPdf<{ dept?: string; date?: string; rows?: ScannedRosterRow[] }>(
    request, instructionsFor('PDF'), ROSTER_SCHEMA
  );
}
