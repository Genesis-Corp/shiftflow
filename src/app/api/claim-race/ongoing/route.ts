import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** GET /api/claim-race/ongoing — races still in progress (for the dashboard). */
export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { data, error } = await supabaseAdmin
    .from('shift_claim_races')
    .select('id, status, created_at')
    .in('status', ['active', 'awaiting_pick'])
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ races: data ?? [] });
}
