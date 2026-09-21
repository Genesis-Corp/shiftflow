import { describe, it, expect } from 'vitest';
import {
  parseInboundMessage, generateClaimCode, generateDistinctCodes,
  CLAIM_CODE_ALPHABET, isRaceOpen, splitContactable,
} from '../claimRace';

describe('parseInboundMessage', () => {
  it('reads the format we ask for', () => {
    expect(parseInboundMessage('YES 4F7K')).toEqual({ intent: 'yes', code: '4F7K' });
  });

  it('tolerates how people actually reply', () => {
    expect(parseInboundMessage('yes 4f7k')).toEqual({ intent: 'yes', code: '4F7K' });
    expect(parseInboundMessage('  Yes   4F7K  ')).toEqual({ intent: 'yes', code: '4F7K' });
    expect(parseInboundMessage('Y 4F7K')).toEqual({ intent: 'yes', code: '4F7K' });
    expect(parseInboundMessage('yep 4F7K')).toEqual({ intent: 'yes', code: '4F7K' });
    expect(parseInboundMessage('OK 4F7K')).toEqual({ intent: 'yes', code: '4F7K' });
    expect(parseInboundMessage('4F7K')).toEqual({ intent: 'yes', code: '4F7K' });
  });

  it('reads declines', () => {
    expect(parseInboundMessage('NO 4F7K')).toEqual({ intent: 'no', code: '4F7K' });
    expect(parseInboundMessage('sorry cant 4F7K')).toEqual({ intent: 'no', code: '4F7K' });
  });

  it('treats opt-out as opt-out even when mixed with other words', () => {
    expect(parseInboundMessage('STOP').intent).toBe('stop');
    expect(parseInboundMessage('stop texting me').intent).toBe('stop');
    expect(parseInboundMessage('unsubscribe').intent).toBe('stop');
    // Must not be read as a decline that leaves them subscribed.
    expect(parseInboundMessage('no thanks, STOP').intent).toBe('stop');
  });

  it('treats START as an opt back in', () => {
    expect(parseInboundMessage('START').intent).toBe('start');
    expect(parseInboundMessage('unstop').intent).toBe('start');
    expect(parseInboundMessage('subscribe').intent).toBe('start');
  });

  it('picks the code rather than an intent word that looks like one', () => {
    // Both YES and 4F7K are 4 chars from the code alphabet.
    expect(parseInboundMessage('YES 4F7K').code).toBe('4F7K');
  });

  it('returns no code when none was sent, for phone fallback', () => {
    expect(parseInboundMessage('yes')).toEqual({ intent: 'yes', code: null });
    expect(parseInboundMessage('')).toEqual({ intent: 'unknown', code: null });
    expect(parseInboundMessage('what shift is this?').intent).toBe('unknown');
  });
});

describe('claim codes', () => {
  it('omits characters that are misread off a phone screen', () => {
    for (const bad of ['0', 'O', '1', 'I', 'L']) {
      expect(CLAIM_CODE_ALPHABET).not.toContain(bad);
    }
  });

  it('generates codes of the right shape', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateClaimCode()).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
    }
  });

  it('never repeats a code within one race', () => {
    const codes = generateDistinctCodes(25);
    expect(new Set(codes).size).toBe(25);
  });

  it('avoids codes already live in another race', () => {
    // Force a generator that always collides with the taken code first.
    const taken = ['AAAA'];
    const codes = generateDistinctCodes(5, taken);
    expect(codes).not.toContain('AAAA');
    expect(new Set(codes).size).toBe(5);
  });
});

describe('isRaceOpen', () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();

  it('is open only while active, unclaimed and unexpired', () => {
    expect(isRaceOpen({ status: 'active', winner_staff_id: null, expires_at: future })).toBe(true);
    expect(isRaceOpen({ status: 'active', winner_staff_id: 'x', expires_at: future })).toBe(false);
    expect(isRaceOpen({ status: 'active', winner_staff_id: null, expires_at: past })).toBe(false);
    expect(isRaceOpen({ status: 'claimed', winner_staff_id: 'x', expires_at: future })).toBe(false);
    expect(isRaceOpen({ status: 'cancelled', winner_staff_id: null, expires_at: future })).toBe(false);
  });
});

describe('splitContactable', () => {
  it('separates who can be reached from who cannot, with reasons', () => {
    const { contactable, excluded } = splitContactable([
      { id: '1', name: 'Dave',  phone_e164: '+61433821798', sms_opt_out: false },
      { id: '2', name: 'Sarah', phone_e164: null,           sms_opt_out: false },
      { id: '3', name: 'Tom',   phone_e164: '+61400000000', sms_opt_out: true  },
    ]);

    expect(contactable.map(c => c.name)).toEqual(['Dave']);
    expect(excluded).toEqual([
      { staffId: '2', name: 'Sarah', reason: 'no_phone' },
      { staffId: '3', name: 'Tom',   reason: 'opted_out' },
    ]);
  });
});
