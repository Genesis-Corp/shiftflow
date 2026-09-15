import crypto from 'node:crypto';
import type { SmsProvider } from './send';

/**
 * Twilio transport, built on the REST API directly so the project keeps no
 * extra runtime dependency.
 *
 * Australia notes:
 *  - TWILIO_FROM_NUMBER must be an Australian MOBILE number (+614...).
 *    Australian local/landline numbers (+612, +618, ...) are not SMS-capable.
 *  - A long code needs no ACMA Sender ID registration. That register, in force
 *    since 1 July 2026, applies only to alphanumeric sender IDs — which cannot
 *    receive replies and so are unusable for a claim race.
 */

const API_BASE = 'https://api.twilio.com/2010-04-01';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is not set. Real SMS cannot be sent. Set SMS_MODE=console to ` +
      `run without Twilio, or configure the Twilio environment variables.`
    );
  }
  return value;
}

export function twilioProvider(): SmsProvider {
  const accountSid = requireEnv('TWILIO_ACCOUNT_SID');
  const authToken = requireEnv('TWILIO_AUTH_TOKEN');
  const from = requireEnv('TWILIO_FROM_NUMBER');

  return {
    name: 'twilio',
    async send(to: string, body: string) {
      const res = await fetch(`${API_BASE}/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: from, Body: body }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (json as { message?: string }).message ?? res.statusText;
        throw new Error(`Twilio ${res.status}: ${detail}`);
      }
      return { sid: (json as { sid: string }).sid };
    },
  };
}

/**
 * Validate an inbound Twilio webhook signature.
 *
 * Twilio signs the exact URL it requested plus every POST parameter, sorted by
 * key and concatenated as key+value. Without this check anyone who discovers
 * the webhook URL can claim shifts on a staff member's behalf.
 *
 * The URL must match byte-for-byte what Twilio called, which is why it comes
 * from TWILIO_WEBHOOK_URL rather than being reconstructed from request headers
 * (proxies rewrite host and protocol).
 */
export function validateTwilioSignature(
  signature: string | null,
  url: string,
  params: Record<string, string>,
  authToken = process.env.TWILIO_AUTH_TOKEN
): boolean {
  if (!signature || !authToken) return false;

  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);

  const expected = crypto
    .createHmac('sha1', authToken)
    .update(Buffer.from(payload, 'utf-8'))
    .digest('base64');

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so guard first.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
