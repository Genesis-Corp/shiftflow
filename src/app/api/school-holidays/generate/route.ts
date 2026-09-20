import { NextRequest, NextResponse } from 'next/server';
import Holidays from 'date-holidays';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';
import { addDays } from '@/lib/shiftUtils';
import { replaceSchoolHolidays } from '@/lib/schoolHolidayStore';
import { mergeHolidayRanges } from '@/lib/schoolTerms';

/**
 * Generates the school holiday calendar from the store's country/state,
 * where date-holidays happens to carry school terms for that location.
 *
 * Coverage is far thinner than for public holidays: school terms are set by
 * each education department rather than gazetted nationally, so the dataset
 * has them for some places (Victoria, Germany, Austria, the Netherlands and
 * a handful of others) and not others — Western Australia included. When a
 * location isn't covered this says so and points at the upload instead,
 * rather than silently producing an empty calendar.
 */

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const startYear = Number(body?.year) || new Date().getFullYear();

  const { data: settings } = await supabase.from('store_settings').select('*').eq('id', 'current').maybeSingle();
  if (!settings?.country) {
    return NextResponse.json({ error: 'Set a country in Settings first.' }, { status: 400 });
  }

  const where = `${settings.country}${settings.state ? '/' + settings.state : ''}`;
  const hd = settings.state ? new Holidays(settings.country, settings.state) : new Holidays(settings.country);

  // Two years, because school holidays run across the year boundary — a
  // manager setting this up late in the year needs the summer break that
  // ends in the next one.
  const spans: { start_date: string; end_date: string; name: string }[] = [];
  for (const year of [startYear, startYear + 1]) {
    for (const h of hd.getHolidays(year).filter(h => h.type === 'school')) {
      // `date` is the local start; `start`/`end` are instants, with `end`
      // landing on local midnight *after* the last day. Measuring the span
      // between them and stepping back one day avoids doing timezone
      // arithmetic on the boundary itself.
      const start_date = h.date.slice(0, 10);
      const spanDays = Math.round((new Date(h.end).getTime() - new Date(h.start).getTime()) / 86_400_000);
      spans.push({ start_date, end_date: addDays(start_date, Math.max(0, spanDays - 1)), name: h.name });
    }
  }

  // The dataset splits a break that crosses new year into two entries, which
  // would otherwise leave 31 December looking like a school day.
  const rows = mergeHolidayRanges(spans);

  if (!rows.length) {
    return NextResponse.json(
      {
        error: `No school term dates are published for ${where}. School terms are set by each education department rather than gazetted nationally, so only some locations are covered — upload your education department's term dates page instead.`,
      },
      { status: 422 }
    );
  }

  const failure = await replaceSchoolHolidays(rows);
  if (failure) return NextResponse.json({ error: failure }, { status: 500 });

  return NextResponse.json({ applied: rows.length, where, holidays: rows });
}
