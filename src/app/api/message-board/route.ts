import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';
import { sendSms } from '@/lib/sms/send';
import { broadcastMessage } from '@/lib/sms/templates';
import { isQuietHours, getTimezone } from '@/lib/sms/config';

export const dynamic = 'force-dynamic';

type TargetType = 'all' | 'departments' | 'custom';

interface StaffRow {
  id: string;
  name: string;
  phone_e164: string | null;
  sms_opt_out: boolean;
  staff_departments?: { department_id: string }[];
}

/**
 * Every active, non-archived staff member matching the requested target —
 * re-derived from the database, never trusted from the browser, same
 * principle as findEligibleCandidates in eligibility.ts.
 */
async function resolveRecipients(
  targetType: TargetType, departmentIds: string[] | undefined, staffIds: string[] | undefined
): Promise<{ contactable: StaffRow[]; total: number; skipped: number }> {
  const { data, error } = await supabaseAdmin
    .from('staff')
    .select('id, name, phone_e164, sms_opt_out, staff_departments ( department_id )')
    .eq('active', true).eq('archived', false);
  if (error) throw new Error(error.message);

  let pool = (data ?? []) as StaffRow[];
  if (targetType === 'departments') {
    const wanted = new Set(departmentIds ?? []);
    pool = pool.filter(s => (s.staff_departments ?? []).some(d => wanted.has(d.department_id)));
  } else if (targetType === 'custom') {
    const wanted = new Set(staffIds ?? []);
    pool = pool.filter(s => wanted.has(s.id));
  }

  const contactable = pool.filter(s => s.phone_e164 && !s.sms_opt_out);
  return { contactable, total: pool.length, skipped: pool.length - contactable.length };
}

/** GET /api/message-board — recent broadcast history for the dashboard feed. */
export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { data, error } = await supabaseAdmin
    .from('message_board_posts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/**
 * POST /api/message-board
 * { urgency: 'urgent'|'general', body, target_type, department_ids?, staff_ids?, force? }
 *
 * Resolves recipients server-side, sends through the same sendSms() safety
 * pipeline as every other message in the app (redirect rewriting, allowlist,
 * console short-circuit, sms_messages audit log), and records one
 * message_board_posts row with the outcome.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { urgency, body, target_type, department_ids, staff_ids, force } = await req.json();

  if (typeof body !== 'string' || !body.trim())
    return NextResponse.json({ error: 'Message body is required' }, { status: 400 });
  if (body.length > 600)
    return NextResponse.json({ error: 'Message is too long (600 characters max)' }, { status: 400 });
  if (urgency !== 'urgent' && urgency !== 'general')
    return NextResponse.json({ error: 'urgency must be "urgent" or "general"' }, { status: 400 });
  if (!['all', 'departments', 'custom'].includes(target_type))
    return NextResponse.json({ error: 'Invalid target_type' }, { status: 400 });
  if (target_type === 'departments' && !(department_ids?.length))
    return NextResponse.json({ error: 'Select at least one department' }, { status: 400 });
  if (target_type === 'custom' && !(staff_ids?.length))
    return NextResponse.json({ error: 'Select at least one staff member' }, { status: 400 });

  // Urgent bypasses quiet hours, the same exception the claim race's
  // immediate tier gets — some updates can't wait for morning. General
  // updates respect quiet hours unless the manager explicitly overrides.
  if (urgency !== 'urgent' && (await isQuietHours()) && !force) {
    return NextResponse.json({
      error: `It is currently quiet hours in ${getTimezone()}. Re-send with force to override, or mark this Urgent.`,
      quiet_hours: true,
    }, { status: 400 });
  }

  let recipients: Awaited<ReturnType<typeof resolveRecipients>>;
  try {
    recipients = await resolveRecipients(target_type, department_ids, staff_ids);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
  const { contactable, skipped } = recipients;

  if (contactable.length === 0) {
    return NextResponse.json(
      { error: 'No contactable staff match this selection (missing phone number, or opted out of SMS).' },
      { status: 400 }
    );
  }

  const { data: profile } = await supabaseAdmin
    .from('manager_profiles').select('name').eq('user_id', user.id).maybeSingle();
  const managerName = profile?.name ?? null;

  const finalBody = broadcastMessage(body.trim(), urgency, managerName);

  let sentCount = 0;
  let failedCount = 0;
  for (const s of contactable) {
    try {
      const result = await sendSms({
        to: s.phone_e164!, body: finalBody, kind: 'broadcast', staffId: s.id, recipientName: s.name,
      });
      if (result.status === 'sent' || result.status === 'simulated') sentCount++;
      else failedCount++;
    } catch {
      // sendSms already logs its own failures to sms_messages; a throw here
      // would mean something unexpected broke — count it as failed rather
      // than aborting the whole broadcast partway through.
      failedCount++;
    }
  }

  const { data: post, error: insertErr } = await supabaseAdmin
    .from('message_board_posts')
    .insert([{
      created_by: user.id,
      manager_name: managerName,
      urgency,
      body: body.trim(),
      target_type,
      target_department_ids: target_type === 'departments' ? department_ids : null,
      target_staff_ids: target_type === 'custom' ? staff_ids : null,
      recipient_count: contactable.length,
      sent_count: sentCount,
      failed_count: failedCount,
      skipped_count: skipped,
    }])
    .select()
    .single();

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
  return NextResponse.json(post, { status: 201 });
}
