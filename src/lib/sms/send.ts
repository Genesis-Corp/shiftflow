import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getSmsMode, getTestNumber, getAllowlist, SmsMode } from './config';

export type MessageKind =
  | 'offer' | 'covered' | 'winner' | 'too_late' | 'declined_ack' | 'opt_out_ack' | 'opt_in_ack'
  | 'availability' | 'availability_ack' | 'manager_list' | 'manager_outcome'
  | 'manager_invalid_pick' | 'manager_stale_pick' | 'broadcast';

export interface SendRequest {
  to: string;                 // intended recipient, E.164
  body: string;
  kind: MessageKind;
  raceId?: string | null;
  staffId?: string | null;
  /** Used for the [TEST -> Name] prefix in redirect mode. */
  recipientName?: string;
}

export interface SendResult {
  ok: boolean;
  status: 'sent' | 'simulated' | 'failed' | 'blocked';
  deliveredTo: string | null;
  providerSid: string | null;
  error?: string;
}

/** A transport that actually puts a message on the network. */
export interface SmsProvider {
  readonly name: string;
  send(to: string, body: string): Promise<{ sid: string }>;
}

/**
 * Resolves the transport for redirect and live modes.
 *
 * Loaded dynamically so that console mode never touches the Twilio module and
 * therefore never requires Twilio credentials to exist. If credentials are
 * missing in a sending mode this throws, which is deliberate: silently falling
 * back to console would leave a manager believing staff were texted when
 * nobody was.
 */
async function getProvider(): Promise<SmsProvider> {
  const { twilioProvider } = await import('./twilio');
  return twilioProvider();
}

/**
 * Send one message, honouring SMS_MODE and the allowlist, and record it in
 * sms_messages either way.
 *
 * The safety rules live here rather than in the callers, so there is no path
 * to the network that skips them.
 */
export async function sendSms(req: SendRequest): Promise<SendResult> {
  const mode: SmsMode = getSmsMode();

  // 1. Where is this message actually going?
  let deliveredTo = req.to;
  let body = req.body;

  if (mode === 'redirect') {
    const testNumber = getTestNumber();
    if (!testNumber) {
      return logAndReturn(req, mode, {
        ok: false, status: 'blocked', deliveredTo: null, providerSid: null,
        error: 'SMS_MODE=redirect but SMS_TEST_NUMBER is not set',
      });
    }
    deliveredTo = testNumber;
    body = `[TEST -> ${req.recipientName ?? req.to}] ${req.body}`;
  }

  // 2. Allowlist. Enforced in every mode, live included, so a mistake in the
  //    UI or the candidate query cannot reach an unexpected number.
  const allowlist = getAllowlist();
  if (allowlist.length > 0 && !allowlist.includes(deliveredTo)) {
    return logAndReturn(req, mode, {
      ok: false, status: 'blocked', deliveredTo, providerSid: null,
      error: `${deliveredTo} is not in SMS_ALLOWLIST`,
    }, body);
  }

  // 3. Console mode stops here — logged, never sent.
  if (mode === 'console') {
    return logAndReturn(req, mode, {
      ok: true, status: 'simulated', deliveredTo, providerSid: null,
    }, body);
  }

  // 4. Real send.
  try {
    const provider = await getProvider();
    const { sid } = await provider.send(deliveredTo, body);
    return logAndReturn(req, mode, {
      ok: true, status: 'sent', deliveredTo, providerSid: sid,
    }, body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return logAndReturn(req, mode, {
      ok: false, status: 'failed', deliveredTo, providerSid: null, error: message,
    }, body);
  }
}

async function logAndReturn(
  req: SendRequest, mode: SmsMode, result: SendResult, finalBody?: string
): Promise<SendResult> {
  const { error } = await supabaseAdmin.from('sms_messages').insert([{
    race_id: req.raceId ?? null,
    staff_id: req.staffId ?? null,
    direction: 'out',
    kind: req.kind,
    to_phone: result.deliveredTo,
    from_phone: process.env.TWILIO_FROM_NUMBER ?? null,
    body: finalBody ?? req.body,
    mode,
    intended_for: mode === 'redirect' ? `${req.recipientName ?? ''} ${req.to}`.trim() : null,
    provider_sid: result.providerSid,
    status: result.status,
    error: result.error ?? null,
  }]);

  // A failed audit write must not mask the send result, but it should be loud.
  if (error) console.error('[sms] failed to write audit log:', error.message);

  return result;
}

/** Record an inbound message. Returns false if this SID was already handled. */
export async function logInbound(params: {
  from: string; to?: string | null; body: string;
  providerSid?: string | null; raceId?: string | null; staffId?: string | null;
}): Promise<boolean> {
  const { error } = await supabaseAdmin.from('sms_messages').insert([{
    race_id: params.raceId ?? null,
    staff_id: params.staffId ?? null,
    direction: 'in',
    kind: 'inbound',
    to_phone: params.to ?? null,
    from_phone: params.from,
    body: params.body,
    mode: getSmsMode(),
    provider_sid: params.providerSid ?? null,
    status: 'received',
  }]);

  // 23505 = unique violation on provider_sid: Twilio retried a delivery it
  // thought failed. Treat it as already-handled rather than replaying it.
  if (error && (error as { code?: string }).code === '23505') return false;
  if (error) console.error('[sms] failed to log inbound:', error.message);
  return true;
}
