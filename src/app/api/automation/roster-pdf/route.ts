import { NextRequest, NextResponse } from 'next/server';
import { requireAutomationToken, automationUnauthorized } from '@/lib/auth';
import { readPdfRequest, visionErrorResponse } from '@/lib/vision';
import { readRosterPdf } from '@/lib/rosterVision';
import { validDate } from '@/lib/humanforceCsv.mjs';
import { readAutomationBody, reconcileHumanforce } from '@/lib/humanforceSync';

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
  return reconcileHumanforce(body.date, read.entries.map(e => ({ ...e, department: e.department ?? read.department })), body.dryRun !== false, [
    { department: null, kind: 'warning', message: 'PDF fallback used. Existing shifts retained; new shifts need CSV or manual review to verify breaks and exclusions.' },
    ...read.warnings.map(message => ({ department: null, kind: 'warning' as const, message })),
  ]);
}
