import { NextRequest, NextResponse } from 'next/server';
import { handleInboundReply } from '@/lib/raceService';
import { getSmsMode } from '@/lib/sms/config';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Simulate an inbound SMS without any carrier involvement.
 *
 * This is the zero-cost way to exercise the full race — including two people
 * replying at once — and it runs the exact same handler the Twilio webhook
 * uses, so a passing simulation means the production path works.
 *
 * Refuses to run when SMS_MODE=live: in production a claim must come from a
 * real phone. Set SMS_SIMULATE_TOKEN for an extra lock on preview deploys.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  if (getSmsMode() === 'live') {
    return NextResponse.json(
      { error: 'Simulation is disabled when SMS_MODE=live.' }, { status: 403 }
    );
  }

  const token = process.env.SMS_SIMULATE_TOKEN?.trim();
  if (token && req.headers.get('x-simulate-token') !== token) {
    return NextResponse.json({ error: 'Invalid simulate token' }, { status: 403 });
  }

  const { recipient_id, body, from } = await req.json();
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 });

  // Resolving the recipient lets the UI say "reply as Dave" without the caller
  // needing to know their phone number or claim code.
  let fromPhone = from as string | undefined;
  if (!fromPhone && recipient_id) {
    const { data } = await supabaseAdmin
      .from('shift_claim_recipients')
      .select('phone_e164').eq('id', recipient_id).single();
    fromPhone = data?.phone_e164 ?? undefined;
  }
  if (!fromPhone) {
    return NextResponse.json(
      { error: 'Could not determine a sending number — pass from or recipient_id' },
      { status: 400 }
    );
  }

  const outcome = await handleInboundReply({
    from: fromPhone,
    body,
    providerSid: `SIM${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
  });

  return NextResponse.json(outcome);
}
