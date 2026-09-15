import { NextRequest, NextResponse } from 'next/server';
import { readImageRequest, readPdfRequest, visionErrorResponse } from '@/lib/vision';
import { readRosterImage, readRosterPdf } from '@/lib/rosterVision';
import { requireUser, unauthorized } from '@/lib/auth';

/**
 * Reads a screenshot — or a PDF export — of one day's roster: a person per
 * row with the hours they are on. Returns it as entries the Shifts page can
 * preview before anything is written.
 *
 * The source rarely carries a date, so the date is chosen in the app; only a
 * date actually printed on the source itself is reported here.
 *
 * The read itself (schema, instructions, parsing) lives in @/lib/rosterVision
 * so the automation pipeline (/api/automation/roster-pdf) reads a source the
 * same way this route does.
 */

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const isPdf = !!(body && typeof body === 'object' && 'pdf' in body);

  try {
    const result = isPdf ? await readFromPdf(body) : await readFromImage(body);

    if (!result.entries.length) {
      return NextResponse.json(
        { error: `No rostered people could be read from that ${isPdf ? 'PDF' : 'screenshot'}. Try again with the whole list in frame.` },
        { status: 422 }
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NextResponse) return err;
    return visionErrorResponse(err, isPdf ? 'PDF' : 'screenshot');
  }
}

async function readFromImage(body: unknown) {
  const request = readImageRequest(body);
  if (request instanceof NextResponse) throw request;
  return readRosterImage(request);
}

async function readFromPdf(body: unknown) {
  const request = readPdfRequest(body);
  if (request instanceof NextResponse) throw request;
  return readRosterPdf(request);
}
