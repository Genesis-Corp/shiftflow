import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/auth';
import { readImage, readImageRequest, readPdf, readPdfRequest, visionErrorResponse } from '@/lib/vision';
import { schoolHolidaysFromScan, ScannedTermEntry } from '@/lib/schoolTerms';

/**
 * Reads a screenshot or PDF of an education department's term dates page
 * into school holiday ranges. Nothing is saved here — the read comes back
 * for a manager to check against the page they took it from before it's
 * applied, since wrong term dates would quietly mark juniors available (or
 * unavailable) at the wrong times for months.
 */

export const maxDuration = 60;

const SCHOOL_TERMS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['region', 'entries'],
  properties: {
    region: {
      type: 'string',
      description:
        'The state, province or region these dates apply to, as named on the page (e.g. "Western Australia", "Victoria", "Bavaria"). Empty string if the page does not say.',
    },
    entries: {
      type: 'array',
      description:
        'Every dated term or holiday period on the page, in the order they appear. Include every year shown, not just the current one. Skip any row explicitly labelled provisional, preliminary, indicative or "to be confirmed" — only take dates the page presents as confirmed.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'name', 'start_date', 'end_date'],
        properties: {
          kind: {
            type: 'string',
            enum: ['term', 'holiday'],
            description:
              'Use "term" for a period when school is IN session (the usual case — most pages list term dates). Use "holiday" only when the page explicitly gives the school holiday/break/vacation period itself.',
          },
          name: {
            type: 'string',
            description:
              'What the page calls this period, including the term number and year where shown (e.g. "Term 1 2026", "Summer holidays"). ',
          },
          start_date: {
            type: 'string',
            description:
              'First day of the period as YYYY-MM-DD. Work out the year from the heading or column the row sits under. Dates are commonly written day-first (e.g. "2 February" or "2/2/2026").',
          },
          end_date: {
            type: 'string',
            description: 'Last day of the period as YYYY-MM-DD, inclusive.',
          },
        },
      },
    },
  },
};

interface SchoolTermsScan {
  region?: string;
  entries?: ScannedTermEntry[];
}

function instructionsFor(kind: 'screenshot' | 'PDF'): string {
  return `This is a ${kind} of an education department's school term dates page.

Read out every dated period it lists. Most such pages give TERM dates (when school is in session), often as a table with one row per term and one block or column per year — capture all of the years shown, not only the first. Some pages instead list the school holidays between terms; mark those as "holiday" so they aren't mistaken for teaching time.

Two things to be careful about:
- Years marked provisional, preliminary, indicative, or "to be confirmed" must be skipped entirely. Only take dates the page presents as final or confirmed.
- Dates are usually written day-first, and the year often appears only in a heading above the row rather than on the row itself. Resolve each date to a full YYYY-MM-DD.

If the ${kind} is not a term dates page at all, return an empty entries array.`;
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const isPdf = !!(body && typeof body === 'object' && 'pdf' in body);
  const kind = isPdf ? 'PDF' : 'screenshot';

  let data: SchoolTermsScan;
  let seconds: number;
  try {
    if (isPdf) {
      const request = readPdfRequest(body);
      if (request instanceof NextResponse) return request;
      ({ data, seconds } = await readPdf<SchoolTermsScan>(request, instructionsFor('PDF'), SCHOOL_TERMS_SCHEMA));
    } else {
      const request = readImageRequest(body);
      if (request instanceof NextResponse) return request;
      ({ data, seconds } = await readImage<SchoolTermsScan>(request, instructionsFor('screenshot'), SCHOOL_TERMS_SCHEMA));
    }
  } catch (err) {
    return visionErrorResponse(err, kind);
  }

  const holidays = schoolHolidaysFromScan(Array.isArray(data.entries) ? data.entries : []);

  if (!holidays.length) {
    return NextResponse.json(
      {
        error: `No school term dates could be read off that ${kind}. Check the whole table is in frame — including the year headings — or add the dates by hand.`,
      },
      { status: 422 }
    );
  }

  return NextResponse.json({
    region: (data.region ?? '').trim(),
    terms_read: (data.entries ?? []).filter(e => e.kind === 'term').length,
    holidays,
    seconds,
  });
}
