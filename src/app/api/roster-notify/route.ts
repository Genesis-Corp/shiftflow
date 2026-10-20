import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';
import { sendSms } from '@/lib/sms/send';
import { rosterChangeMessage } from '@/lib/sms/templates';
import { isQuietHours, getTimezone, getBusinessName } from '@/lib/sms/config';

export const dynamic = 'force-dynamic';

const MAX_RECIPIENTS = 500;

/**
 * POST /api/roster-notify
 * { staff_ids: string[], force?: boolean }
 *
 * Texts the fixed "roster changed, check Humanforce" notice to the selected
 * staff only. Recipients are re-resolved from the database (active, not
 * archived, has a phone, not opted out) — the browser's selection is a
 * request, never the source of truth — and every message goes through
 * sendSms() so SMS_MODE, the allowlist and the sms_messages audit log all
 * apply exactly as they do for the Message Board.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { staff_ids, force } = await req.json();

  if (!Array.isArray(staff_ids) || staff_ids.length === 0 || !staff_ids.every(id => typeof id === 'string'))
    return NextResponse.json({ error: 'Select at least one staff member' }, { status: 400 });
  if (staff_ids.length > MAX_RECIPIENTS)
    return NextResponse.json({ error: `Too many recipients (${MAX_RECIPIENTS} max)` }, { status: 400 });

  if ((await isQuietHours()) && !force) {
    return NextResponse.json({
      error: `It is currently quiet hours in ${getTimezone()}. Send anyway to override.`,
      quiet_hours: true,
    }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('staff')
    .select('id, name, phone_e164, sms_opt_out')
    .in('id', staff_ids)
    .eq('active', true).eq('archived', false);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const pool = data ?? [];
  const contactable = pool.filter(s => s.phone_e164 && !s.sms_opt_out);
  const skipped = staff_ids.length - contactable.length;

  if (contactable.length === 0) {
    return NextResponse.json(
      { error: 'None of the selected staff can be texted (missing phone number, or opted out of SMS).' },
      { status: 400 }
    );
  }

  const body = rosterChangeMessage(await getBusinessName());

  let sent = 0;
  let failed = 0;
  for (const s of contactable) {
    try {
      const result = await sendSms({
        to: s.phone_e164!, body, kind: 'roster_change', staffId: s.id, recipientName: s.name,
      });
      if (result.status === 'sent' || result.status === 'simulated') sent++;
      else failed++;
    } catch {
      // sendSms logs its own failures; count and keep going so one bad
      // number doesn't stop everyone else being told.
      failed++;
    }
  }

  return NextResponse.json({ sent, failed, skipped }, { status: 200 });
}
