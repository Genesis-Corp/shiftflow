import { NextRequest, NextResponse } from 'next/server';
import { requireAutomationToken, automationUnauthorized } from '@/lib/auth';
import { readPdfRequest, visionErrorResponse } from '@/lib/vision';
import { readRosterPdf } from '@/lib/rosterVision';
import { validDate } from '@/lib/humanforceCsv.mjs';
import { readAutomationBody, SYNC_PROTOCOL } from '@/lib/humanforceSync';

export const maxDuration = 60;

/** PDF is a review fallback: the vision reader cannot verify CSV break segments. */
export async function POST(req: NextRequest) {
  if (!requireAutomationToken(req)) return automationUnauthorized();
  let body;
  try { body = await readAutomationBody(req, 20_000_000); }
  catch { return NextResponse.json({ error: 'Invalid or oversized PDF request.' }, { status: 400 }); }
  if (!validDate(body?.date) || (body.dryRun !== undefined && typeof body.dryRun !== 'boolean')) {
    return NextResponse.json({ error: 'Valid date and boolean dryRun required.' }, { status: 400 });
  }
  const request = readPdfRequest(body);
  if (request instanceof NextResponse) return request;
  let read;
  try { read = await readRosterPdf(request); }
  catch (error) { return visionErrorResponse(error, 'PDF'); }
  if (read.date !== body.date) return NextResponse.json({ error: 'PDF printed date is missing or differs from requested date.' }, { status: 422 });
  // PDF is investigative evidence only. Never run PDF-derived entries through the
  // replacement planner: incomplete visual extraction would produce misleading
  // deletion proposals against the existing database roster.
  const flags = [
    { department: null, kind: 'warning', message: 'Investigative PDF only: CSV requires review; no shifts can be created, updated, or deleted from this report.' },
    ...read.warnings.map(message => ({ department: null, kind: 'warning', message })),
  ];
  return NextResponse.json({
    protocol: SYNC_PROTOCOL, date: body.date, dry_run: true,
    investigative_only: true, source_shifts: read.entries.length,
    duplicates: 0, proposed_shifts: 0, proposed_deletions: 0,
    shifts_created: 0, shifts_deleted: 0, departments_applied: 0,
    flags, can_apply: false,
  });
}
