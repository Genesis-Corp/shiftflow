import { describe, it, expect } from 'vitest';
import { validateTwilioSignature } from '../sms/twilio';

/**
 * Worked example from Twilio's security documentation. If this test fails,
 * the webhook is rejecting (or worse, accepting) requests incorrectly.
 */
const DOC_URL = 'https://example.com/myapp.php?foo=1&bar=2';
const DOC_PARAMS = {
  CallSid: 'CA1234567890ABCDE',
  Caller: '+14158675310',
  Digits: '1234',
  From: '+14158675310',
  To: '+18005551212',
};
const DOC_TOKEN = '12345';
const DOC_SIGNATURE = 'L/OH5YylLD5NRKLltdqwSvS0BnU=';

describe('validateTwilioSignature', () => {
  it("matches Twilio's published example", () => {
    expect(validateTwilioSignature(DOC_SIGNATURE, DOC_URL, DOC_PARAMS, DOC_TOKEN)).toBe(true);
  });

  it('rejects a tampered parameter', () => {
    // An attacker swapping the sender to claim a shift as someone else.
    const tampered = { ...DOC_PARAMS, From: '+61491570156' };
    expect(validateTwilioSignature(DOC_SIGNATURE, DOC_URL, tampered, DOC_TOKEN)).toBe(false);
  });

  it('rejects a tampered URL', () => {
    expect(validateTwilioSignature(
      DOC_SIGNATURE, 'https://evil.example.com/myapp.php?foo=1&bar=2', DOC_PARAMS, DOC_TOKEN
    )).toBe(false);
  });

  it('rejects the wrong auth token', () => {
    expect(validateTwilioSignature(DOC_SIGNATURE, DOC_URL, DOC_PARAMS, 'wrong')).toBe(false);
  });

  it('rejects a missing signature or missing token', () => {
    expect(validateTwilioSignature(null, DOC_URL, DOC_PARAMS, DOC_TOKEN)).toBe(false);
    expect(validateTwilioSignature('', DOC_URL, DOC_PARAMS, DOC_TOKEN)).toBe(false);
    expect(validateTwilioSignature(DOC_SIGNATURE, DOC_URL, DOC_PARAMS, undefined)).toBe(false);
  });

  it('rejects a signature of the wrong length without throwing', () => {
    expect(validateTwilioSignature('short', DOC_URL, DOC_PARAMS, DOC_TOKEN)).toBe(false);
  });

  it('is insensitive to parameter ordering', () => {
    const reordered = {
      To: DOC_PARAMS.To, Digits: DOC_PARAMS.Digits, CallSid: DOC_PARAMS.CallSid,
      From: DOC_PARAMS.From, Caller: DOC_PARAMS.Caller,
    };
    expect(validateTwilioSignature(DOC_SIGNATURE, DOC_URL, reordered, DOC_TOKEN)).toBe(true);
  });
});
