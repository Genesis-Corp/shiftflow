import { NextRequest, NextResponse } from 'next/server';
import { handleInboundReply } from '@/lib/raceService';
import { validateTwilioSignature } from '@/lib/sms/twilio';
import { sendSms } from '@/lib/sms/send';
import { getSmsMode } from '@/lib/sms/config';

export const dynamic = 'force-dynamic';

/**
 * Twilio inbound SMS webhook.
 *
 * Configure this URL on the number in the Twilio console:
 *   Phone Numbers -> your +614… number -> Messaging -> "A message comes in"
 *   POST https://<your-app>/api/sms/inbound
 *
 * The reply rides back in the TwiML response rather than costing a second
 * outbound API call.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((value, key) => { params[key] = String(value); });

  // Signature validation. Without it, anyone who finds this URL can claim a
  // shift as any staff member. The URL must match what Twilio signed exactly,
  // so it comes from config rather than from proxy-rewritten request headers.
  const webhookUrl = process.env.TWILIO_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('[sms] TWILIO_WEBHOOK_URL is not set — rejecting inbound webhook.');
    return new NextResponse('Webhook not configured', { status: 500 });
  }

  const valid = validateTwilioSignature(
    req.headers.get('x-twilio-signature'), webhookUrl, params
  );
  if (!valid) {
    console.warn('[sms] Rejected inbound webhook: bad signature.');
    return new NextResponse('Invalid signature', { status: 403 });
  }

  const from = params.From ?? '';
  const body = params.Body ?? '';
  if (!from) return twiml(null);

  const outcome = await handleInboundReply({
    from, body, to: params.To ?? null, providerSid: params.MessageSid ?? null,
  });

  if (!outcome.reply) return twiml(null);

  // In redirect mode every reply comes from the tester's own phone, so routing
  // the response through sendSms keeps the [TEST -> Name] prefix and the audit
  // log consistent. In live mode TwiML is free, so use it.
  if (getSmsMode() === 'redirect') {
    await sendSms({
      to: from,
      body: outcome.reply,
      kind: outcome.result === 'won' ? 'winner'
        : outcome.result === 'too_late' ? 'too_late'
        : outcome.result === 'declined' ? 'declined_ack' : 'opt_out_ack',
      raceId: outcome.raceId ?? null,
      staffId: outcome.staffId ?? null,
    });
    return twiml(null);
  }

  return twiml(outcome.reply);
}

function twiml(message: string | null): NextResponse {
  const xml = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response/>`;
  return new NextResponse(xml, {
    status: 200, headers: { 'Content-Type': 'text/xml' },
  });
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));
}
