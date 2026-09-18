import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';
import { readImage, readImageRequest, readPdf, readPdfRequest, visionErrorResponse } from '@/lib/vision';
import { parseDollarAmount, csvRowsToBaseRate } from '@/lib/wages';

/**
 * Reads the one figure that matters off a wage table — the adult ordinary
 * hourly rate (Monday-Friday, full/part-time) — rather than matching
 * individual staff names against it. Everyone's actual rate is computed
 * from this figure plus their age and employment type, never typed in
 * separately, so the only thing this ever needs to find is that one cell.
 *
 * Nothing is written here: the Managers page previews the read figure
 * first, since it decides every wage the app computes from here on.
 */

export const maxDuration = 60;

const RATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rate'],
  properties: {
    rate: { type: 'string', description: 'The adult ordinary hourly rate exactly as printed, including any $ sign.' },
  },
};

function instructionsFor(kind: 'photograph' | 'PDF'): string {
  return `This is a ${kind} of an award wage table from a supermarket.

Find the ADULT, ORDINARY, MONDAY-TO-FRIDAY, FULL-TIME/PART-TIME hourly rate — the base figure the rest of the
table's loadings (Saturday, Sunday, public holiday, evening, junior percentages, etc.) are worked out from. It is
usually the first dollar figure in the row labelled "Adult" or "100%", under a column labelled something like
"Ordinary Hourly Rate" for full-time or part-time employees (not the casual column, which already includes a
loading on top of it).

Return only that one figure, exactly as printed including the $ if shown. If you cannot find a row clearly
labelled for adult ordinary full-time/part-time pay, or more than one figure could plausibly be it, return "?"
rather than guessing — a wrong base rate would misprice every wage the app computes from it.`;
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const isCsv = !!(body && typeof body === 'object' && 'csv' in body);
  const isPdf = !isCsv && !!(body && typeof body === 'object' && 'pdf' in body);
  const kind = isCsv ? 'CSV' : isPdf ? 'PDF' : 'photo';

  let rate: number | null = null;

  if (isCsv) {
    const csvRows = (body as { csv?: Record<string, string>[] }).csv;
    if (!Array.isArray(csvRows) || !csvRows.length) {
      return NextResponse.json({ error: 'That CSV had no rows.' }, { status: 400 });
    }
    rate = csvRowsToBaseRate(csvRows);
  } else {
    let data: { rate?: string };
    try {
      if (isPdf) {
        const request = readPdfRequest(body);
        if (request instanceof NextResponse) return request;
        ({ data } = await readPdf<{ rate?: string }>(request, instructionsFor('PDF'), RATE_SCHEMA));
      } else {
        const request = readImageRequest(body);
        if (request instanceof NextResponse) return request;
        ({ data } = await readImage<{ rate?: string }>(request, instructionsFor('photograph'), RATE_SCHEMA));
      }
    } catch (err) {
      return visionErrorResponse(err, kind);
    }
    rate = parseDollarAmount(data.rate ?? '');
  }

  if (!rate) {
    return NextResponse.json(
      { error: `Could not find a clear adult ordinary hourly rate in that ${kind}. Check the whole table is in frame, or enter the rate by hand.` },
      { status: 422 }
    );
  }

  const { data: current } = await supabase.from('wage_base_rate').select('adult_hourly_rate').eq('id', 'current').maybeSingle();

  return NextResponse.json({ rate, current_rate: current?.adult_hourly_rate ?? null });
}
