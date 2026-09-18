import { NextRequest, NextResponse } from 'next/server';
import Holidays from 'date-holidays';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';

/**
 * Auto-generates the public holiday calendar for a year from the store's
 * country/state, using date-holidays — a maintained dataset covering 200+
 * countries with state/province-level rules (so Western Australia's King's
 * Birthday, on a different date to the rest of the country, comes out
 * right; so would a California-specific date for a US store). Applied
 * directly to public_holidays, not just previewed — this is real gazetted
 * data, not a guess.
 */

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const year = Number(body?.year) || new Date().getFullYear();

  const { data: settings } = await supabase.from('store_settings').select('*').eq('id', 'current').maybeSingle();
  if (!settings?.country) {
    return NextResponse.json({ error: 'Set a country in Settings first.' }, { status: 400 });
  }

  const hd = settings.state ? new Holidays(settings.country, settings.state) : new Holidays(settings.country);
  const holidays = hd.getHolidays(year).filter(h => h.type === 'public');

  if (!holidays.length) {
    return NextResponse.json(
      { error: `No public holidays found for ${settings.country}${settings.state ? '/' + settings.state : ''} in ${year} — that country or state may not be supported yet.` },
      { status: 422 }
    );
  }

  const rows = holidays.map(h => ({ date: h.date.slice(0, 10), name: h.name }));
  const { error } = await supabase.from('public_holidays').upsert(rows, { onConflict: 'date' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ applied: rows.length, holidays: rows });
}
