import { describe, it, expect } from 'vitest';
import {
  offerMessage, winnerMessage, coveredMessage, tooLateMessage,
  declinedMessage, smsSegments, isGsm7, formatShiftTimes,
  availabilityMessage, availabilityAckMessage, managerListMessage, managerStaleSelectionMessage,
  managerInvalidPickMessage, managerOutcomeMessage,
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

  it('opens with the starting manager\'s name when given one', () => {
    const withName = offerMessage(SHIFT, '4F7K', 'John');
    expect(withName.startsWith("Hey it's John - ")).toBe(true);
    expect(smsSegments(withName)).toBe(1);

    const withoutName = offerMessage(SHIFT, '4F7K');
    expect(withoutName.startsWith("Hey it's")).toBe(false);

    const withNullName = offerMessage(SHIFT, '4F7K', null);
    expect(withNullName).toBe(withoutName);
  });
});

describe('gather-tier and manager-pick messages', () => {
  const OPTIONS = [
    { option: 1, name: 'Alice', cost: 28.69 },
    { option: 2, name: 'Bob', cost: null },
  ];

  it('asks availability without a claim code or "first reply wins"', () => {
    const msg = availabilityMessage(SHIFT);
    expect(msg).not.toContain('claim');
    expect(msg).toContain('YES or NO');
  });

  it('opens the availability ask with the manager\'s name too, same as the offer', () => {
    const withName = availabilityMessage(SHIFT, 'John');
    expect(withName.startsWith("Hey it's John - ")).toBe(true);
    expect(availabilityMessage(SHIFT).startsWith("Hey it's")).toBe(false);
  });

  it('acknowledges a gather-tier yes without implying it won the shift', () => {
    const msg = availabilityAckMessage();
    expect(msg.toLowerCase()).not.toContain('yours');
    expect(msg.toLowerCase()).not.toContain('win');
  });

  it('lists options with a dollar figure or "no rate" when unset', () => {
    const msg = managerListMessage(SHIFT, OPTIONS);
    expect(msg).toContain('1. Alice - $28.69');
    expect(msg).toContain('2. Bob - no rate');
  });

  it('says nobody is available when the options list is empty', () => {
    expect(managerListMessage(SHIFT, [])).toContain('nobody is available');
  });

  it('reports who is covering, or that nobody is', () => {
    expect(managerOutcomeMessage(SHIFT, 'Christopher')).toContain('Christopher will cover');
    expect(managerOutcomeMessage(SHIFT, null)).toContain('nobody was available');
  });

  it('keeps every manager-facing message to a single SMS segment', () => {
    // These previously used an em dash outside the GSM-7 alphabet, which
    // silently doubled the segment count — plain hyphens keep them GSM-7.
    const messages = [
      availabilityMessage(SHIFT),
      availabilityAckMessage(),
      managerListMessage(SHIFT, OPTIONS),
      managerListMessage(SHIFT, []),
      managerStaleSelectionMessage(),
      managerInvalidPickMessage(),
      managerOutcomeMessage(SHIFT, 'Christopher'),
      managerOutcomeMessage(SHIFT, null),
    ];
    for (const m of messages) {
      expect(isGsm7(m), `"${m}" is not GSM-7`).toBe(true);
      expect(smsSegments(m), `"${m}" (${m.length} chars)`).toBe(1);
    }
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
