import { NextRequest, NextResponse } from 'next/server';
import { requireAutomationToken, automationUnauthorized } from '@/lib/auth';
import { advanceAllActiveRaces } from '@/lib/raceService';

/**
 * Scheduled tick for running claim races — texts the next person once a
 * sequential step or immediate batch times out, closes gather windows, and
 * expires races that have run their course, even when no manager has the
 * race open. Hit every few minutes by .github/workflows/advance-races.yml.
 *
 * Auth is a bearer token (AUTOMATION_TOKEN), same as the roster automation.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!requireAutomationToken(req)) return automationUnauthorized();
  const result = await advanceAllActiveRaces();
  return NextResponse.json(result);
}
