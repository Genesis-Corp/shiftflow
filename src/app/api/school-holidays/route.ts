import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';
import { replaceSchoolHolidays } from '@/lib/schoolHolidayStore';

/** The school-term holiday calendar — date ranges, entered manually (there's
 *  no maintained public data source for individual school terms the way
 *  there is for public holidays). A weekday outside every stored range,
 *  and not a public holiday, counts as a school day: juniors are treated as
 *  unavailable before 3pm on it (see isSchoolTermWeekday in shiftUtils.ts). */

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { data, error } = await supabase.from('school_holidays').select('*').order('start_date');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);

  // A batch — applying what was read off an uploaded term dates page.
  if (Array.isArray(body?.holidays)) {
    const rows = (body.holidays as unknown[])
      .map(h => h as { start_date?: unknown; end_date?: unknown; name?: unknown })
      .filter(h =>
        typeof h.start_date === 'string' && ISO_DATE.test(h.start_date) &&
        typeof h.end_date === 'string' && ISO_DATE.test(h.end_date) &&
        h.end_date >= h.start_date &&
        typeof h.name === 'string' && h.name.trim()
      )
      .map(h => ({ start_date: h.start_date as string, end_date: h.end_date as string, name: (h.name as string).trim() }));

    if (!rows.length) return NextResponse.json({ error: 'No usable school holiday dates were sent.' }, { status: 400 });

    const failure = await replaceSchoolHolidays(rows);
    if (failure) return NextResponse.json({ error: failure }, { status: 500 });
    return NextResponse.json({ applied: rows.length }, { status: 201 });
  }

  const start_date = typeof body?.start_date === 'string' ? body.start_date : '';
  const end_date = typeof body?.end_date === 'string' ? body.end_date : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
    return NextResponse.json({ error: 'A valid start and end date are required.' }, { status: 400 });
  }
  if (end_date < start_date) {
    return NextResponse.json({ error: 'End date must be on or after the start date.' }, { status: 400 });
  }
  if (!name) return NextResponse.json({ error: 'Give the holiday a name.' }, { status: 400 });

  const { data, error } = await supabase.from('school_holidays').insert([{ start_date, end_date, name }]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });

  const { error } = await supabase.from('school_holidays').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
