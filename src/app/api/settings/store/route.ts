import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';

/** Country/state the store operates in — drives the auto-generated public
 *  holiday calendar (see /api/wages/holidays/generate) — and the store's own
 *  SMS quiet-hours window (see @/lib/sms/config's getQuietHours). Both live
 *  on the same single-row table since neither has anywhere else to live. */

const TIME_RE = /^\d{2}:\d{2}$/;

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { data, error } = await supabase.from('store_settings').select('*').eq('id', 'current').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(
    data ?? { id: 'current', country: null, state: null, quiet_hours_start: null, quiet_hours_end: null }
  );
}

export async function PUT(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  // Each part of this row is saved from its own form on the Settings page —
  // country/state and quiet hours arrive in separate requests — so only the
  // fields actually present are touched; the rest of the row is left alone.
  const updates: Record<string, unknown> = { id: 'current', updated_at: new Date().toISOString() };

  if (body?.country !== undefined) {
    const country = typeof body.country === 'string' ? body.country.trim().toUpperCase() : '';
    if (!country) return NextResponse.json({ error: 'country is required.' }, { status: 400 });
    updates.country = country;
    updates.state = typeof body?.state === 'string' && body.state.trim() ? body.state.trim().toUpperCase() : null;
  }

  if (body?.quiet_hours_start !== undefined || body?.quiet_hours_end !== undefined) {
    const start = typeof body.quiet_hours_start === 'string' ? body.quiet_hours_start.trim() : null;
    const end = typeof body.quiet_hours_end === 'string' ? body.quiet_hours_end.trim() : null;
    if ((start && !end) || (!start && end)) {
      return NextResponse.json({ error: 'Set both a start and end time, or clear both to turn quiet hours off.' }, { status: 400 });
    }
    if ((start && !TIME_RE.test(start)) || (end && !TIME_RE.test(end))) {
      return NextResponse.json({ error: 'Quiet hours must be a valid time.' }, { status: 400 });
    }
    updates.quiet_hours_start = start || null;
    updates.quiet_hours_end = end || null;
  }

  if (Object.keys(updates).length <= 2) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('store_settings')
    .upsert([updates], { onConflict: 'id' })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
