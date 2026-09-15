import { describe, it, expect } from 'vitest';
import {
  offerMessage, winnerMessage, coveredMessage, tooLateMessage,
  declinedMessage, smsSegments, isGsm7, formatShiftTimes,
} from '../sms/templates';

const SHIFT = {
  date: '2026-09-15', start_time: '09:00:00', end_time: '17:00:00',
  departmentName: 'Bakery',
};

describe('message templates', () => {
  it('includes the claim code and the business name in the offer', () => {
    const msg = offerMessage(SHIFT, '4F7K');
    expect(msg).toContain('4F7K');
    expect(msg).toContain('Bakery');
    expect(msg).toContain('STOP');
  });

  it('trims the seconds Postgres returns on a time column', () => {
    expect(formatShiftTimes('09:00:00', '17:00:00')).toBe('09:00-17:00');
    expect(offerMessage(SHIFT, '4F7K')).not.toContain(':00:00');
  });

  it('keeps every message to a single SMS segment', () => {
    // At 161 GSM-7 characters the cost silently doubles.
    const messages = [
      offerMessage(SHIFT, '4F7K'),
      winnerMessage(SHIFT, 'Christopher'),
      coveredMessage(SHIFT),
      tooLateMessage(SHIFT),
      declinedMessage(),
    ];
    for (const m of messages) {
      expect(smsSegments(m), `"${m}" (${m.length} chars)`).toBe(1);
    }
  });

  it('uses only GSM-7 characters, so no message drops to a 70-char segment', () => {
    expect(isGsm7(offerMessage(SHIFT, '4F7K'))).toBe(true);
    expect(isGsm7(coveredMessage(SHIFT))).toBe(true);
  });
});

describe('smsSegments', () => {
  it('counts GSM-7 segments', () => {
    expect(smsSegments('a'.repeat(160))).toBe(1);
    expect(smsSegments('a'.repeat(161))).toBe(2);
  });

  it('counts UCS-2 segments when a non-GSM character appears', () => {
    expect(smsSegments('😀')).toBe(1);
    expect(smsSegments('😀' + 'a'.repeat(100))).toBe(2);
  });
});
