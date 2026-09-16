import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';
import { readImage, readImageRequest, readPdf, readPdfRequest, visionErrorResponse } from '@/lib/vision';
import { parseWageRows, ScannedWageRow } from '@/lib/wages';
import { matchStaffName, hasNameCandidate, RosterEntry } from '@/lib/roster';

/**
 * Reads a printed wage sheet — photo or PDF — into hourly rates, matched
 * against the staff list. Nothing is written here: the Managers page previews
 * the result first, because a misread digit in a pay rate is the kind of
 * mistake that decides who gets called in to work.
 */

export const maxDuration = 60;

const TEXT = { type: 'string' } as const;

const WAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rows'],
  properties: {
    rows: {
      type: 'array',
      description: 'One entry per person listed, top to bottom.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['n', 'r'],
        properties: {
          n: { ...TEXT, description: 'Name exactly as printed.' },
          r: { ...TEXT, description: 'That person\'s hourly rate exactly as printed, including any $ sign.' },
        },
      },
    },
  },
};

function instructionsFor(kind: 'photograph' | 'PDF'): string {
  return `This is a ${kind} of a staff wage sheet from a supermarket.

Transcribe it row by row, exactly as printed. Do not interpret, tidy, convert or calculate anything.

For each person listed return:
- n: their name exactly as printed.
- r: their ORDINARY HOURLY rate exactly as printed, including the $ if shown.

Rules:
- If the sheet has several rate columns (for example ordinary, Saturday, Sunday, public holiday), return only the ordinary/base hourly rate.
- If a row shows a weekly or annual salary rather than an hourly rate, return that figure as printed and do not convert it.
- Copy every digit as printed, including cents.
- If any character of a rate is not clearly legible, use "?" for that rate rather than guessing. Never invent a digit in someone's pay.
- Skip heading rows, totals, and any row that is not a person.`;
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const isPdf = !!(body && typeof body === 'object' && 'pdf' in body);

  let data: { rows?: ScannedWageRow[] };
  try {
    if (isPdf) {
      const request = readPdfRequest(body);
      if (request instanceof NextResponse) return request;
      ({ data } = await readPdf<{ rows?: ScannedWageRow[] }>(request, instructionsFor('PDF'), WAGE_SCHEMA));
    } else {
      const request = readImageRequest(body);
      if (request instanceof NextResponse) return request;
      ({ data } = await readImage<{ rows?: ScannedWageRow[] }>(request, instructionsFor('photograph'), WAGE_SCHEMA));
    }
  } catch (err) {
    return visionErrorResponse(err, isPdf ? 'PDF' : 'wage sheet');
  }

  const { wages, warnings } = parseWageRows(data.rows ?? []);
  if (!wages.length) {
    return NextResponse.json(
      { error: `No rates could be read from that ${isPdf ? 'PDF' : 'photo'}. Try again with the whole sheet in frame.`, warnings },
      { status: 422 }
    );
  }

  const [staffRes, existingRes] = await Promise.all([
    supabase.from('staff').select('id, name, active'),
    supabase.from('staff_wages').select('staff_id, base_hourly_rate'),
  ]);
  if (staffRes.error) {
    return NextResponse.json({ error: `Could not read the staff list: ${staffRes.error.message}` }, { status: 500 });
  }

  const staff = (staffRes.data ?? []) as { id: string; name: string; active: boolean }[];
  const current = new Map(
    (existingRes.data ?? []).map((w: { staff_id: string; base_hourly_rate: number }) => [w.staff_id, Number(w.base_hourly_rate)])
  );

  const matched: { staff_id: string; name: string; rate: number; current_rate: number | null }[] = [];
  const unmatched: { name: string; rate: number }[] = [];

  for (const wage of wages) {
    const probe: RosterEntry = {
      name: wage.name, start_time: null, end_time: null, status: null, truncated: false, department: null,
    };
    const person = matchStaffName(probe, staff);
    if (!person) {
      unmatched.push({ name: wage.name, rate: wage.rate });
      if (hasNameCandidate(probe, staff)) {
        warnings.push(`${wage.name} matches more than one person on the staff list — set their rate by hand.`);
      }
      continue;
    }
    matched.push({
      staff_id: person.id,
      name: person.name,
      rate: wage.rate,
      current_rate: current.get(person.id) ?? null,
    });
  }

  return NextResponse.json({ matched, unmatched, warnings });
}
