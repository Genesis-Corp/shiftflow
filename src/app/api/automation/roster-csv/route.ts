import { NextRequest, NextResponse } from 'next/server';
import { requireAutomationToken, automationUnauthorized } from '@/lib/auth';
import { parseHumanforceCsv, validDate } from '@/lib/humanforceCsv.mjs';
import { readAutomationBody, reconcileHumanforce, SYNC_PROTOCOL } from '@/lib/humanforceSync';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!requireAutomationToken(req)) return automationUnauthorized();
  const [transaction, audit] = await Promise.all([
    supabase.rpc('apply_humanforce_sync', { p_date: '2000-01-01', p_shifts: [], p_flags: [], p_dry_run: true }),
    supabase.from('automation_runs').select('id').limit(1),
  ]);
  const ready = !transaction.error && !audit.error;
  return NextResponse.json({ protocol: SYNC_PROTOCOL, ready }, { status: ready ? 200 : 503 });
}

export async function POST(req: NextRequest) {
  if (!requireAutomationToken(req)) return automationUnauthorized();
  let body, parsed;
  try {
    body = await readAutomationBody(req, 2_100_000);
    if (!validDate(body?.date) || typeof body?.csv !== 'string') throw new Error('date and csv are required.');
    if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') throw new Error('dryRun must be boolean.');
    parsed = parseHumanforceCsv(body.csv, body.date, process.env.HUMANFORCE_SITE || 'Phoenix / Spearwood');
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid CSV request.' }, { status: 422 });
  }
  return reconcileHumanforce(body.date, parsed.entries, body.dryRun !== false);
}
