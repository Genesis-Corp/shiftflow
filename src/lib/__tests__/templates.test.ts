import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  winnerMessage, coveredMessage, tooLateMessage, urgentAvailabilityMessage,
  declinedMessage, smsSegments, isGsm7, formatShiftTimes, formatShiftDate, describeShift,
  availabilityMessage, availabilityAckMessage, managerListMessage, managerStaleSelectionMessage,
  managerInvalidPickMessage, managerOutcomeMessage,
} from '../sms/templates';

const SHIFT = {
  date: '2026-09-15', start_time: '09:00:00', end_time: '17:00:00',
  departmentName: 'Bakery',
};

describe('message templates', () => {
  it('trims the seconds Postgres returns on a time column', () => {
    expect(formatShiftTimes('09:00:00', '17:00:00')).toBe('09:00-17:00');
    expect(availabilityMessage(SHIFT)).not.toContain(':00:00');
  });

  it('keeps every message to a single SMS segment', () => {
    // At 161 GSM-7 characters the cost silently doubles.
    const messages = [
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
    expect(isGsm7(availabilityMessage(SHIFT))).toBe(true);
    expect(isGsm7(coveredMessage(SHIFT))).toBe(true);
  });
});

describe('gather-tier and manager-pick messages', () => {
  const OPTIONS = [
    { option: 1, name: 'Alice', cost: 28.69 },
    { option: 2, name: 'Bob', cost: null },
  ];

  it('asks availability without a claim code or "first reply wins", but still offers an opt-out', () => {
    const msg = availabilityMessage(SHIFT);
    expect(msg).not.toContain('claim');
    expect(msg).not.toContain('first reply wins');
    expect(msg).toContain('YES or NO');
    expect(msg).toContain('STOP');
  });

  it('opens the availability ask with the manager\'s name too', () => {
    const withName = availabilityMessage(SHIFT, 'John');
    expect(withName.startsWith("Hey it's John - ")).toBe(true);
    expect(availabilityMessage(SHIFT).startsWith("Hey it's")).toBe(false);

    const withNullName = availabilityMessage(SHIFT, null);
    expect(withNullName).toBe(availabilityMessage(SHIFT));
  });

  it('the immediate tier\'s urgent ask also carries no claim code but does offer an opt-out', () => {
    const msg = urgentAvailabilityMessage(SHIFT, false);
    expect(msg).not.toContain('claim');
    expect(msg).not.toContain('first reply wins');
    expect(msg).toContain('YES or NO');
    expect(msg).toContain('STOP');
    expect(smsSegments(msg)).toBe(1);

    const withName = urgentAvailabilityMessage(SHIFT, false, 'John');
    expect(withName.startsWith("Hey it's John - ")).toBe(true);
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

describe('formatShiftDate', () => {
  it('says "Today" when the shift date matches the reference date', () => {
    expect(formatShiftDate('2026-09-15', '2026-09-15')).toBe('Today');
  });

  it('says "Tomorrow" when the shift is the day after the reference date', () => {
    expect(formatShiftDate('2026-09-16', '2026-09-15')).toBe('Tomorrow');
  });

  it('falls back to the weekday and date for anything further out', () => {
    // Exact separators/abbreviations come from the ICU data on the running
    // Node version — assert the parts rather than the whole string.
    const further = formatShiftDate('2026-09-17', '2026-09-15');
    expect(further).toContain('Thu');
    expect(further).toContain('17');
    expect(further).not.toBe('Today');
    expect(further).not.toBe('Tomorrow');

    const dayBefore = formatShiftDate('2026-09-14', '2026-09-15');
    expect(dayBefore).toContain('Mon');
    expect(dayBefore).toContain('14');
  });
});

describe('describeShift', () => {
  it('uses formatShiftDate\'s Today/Tomorrow reading in place of the weekday', () => {
    expect(describeShift(SHIFT, SHIFT.date)).toMatch(/^Today /);
    expect(describeShift(SHIFT, '2026-09-14')).toMatch(/^Tomorrow /);
  });
});

describe('date-relative messages, against the real clock', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('reads "Today" when the shift falls on the current date', () => {
    // Noon in Perth (UTC+8) on the shift's own date.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${SHIFT.date}T04:00:00Z`));
    expect(availabilityMessage(SHIFT)).toContain('Today');
    expect(urgentAvailabilityMessage(SHIFT, false)).toContain('today');
  });

  it('reads "Tomorrow" when the shift is the day after the current date', () => {
    // Noon in Perth the day before the shift.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T04:00:00Z'));
    expect(availabilityMessage(SHIFT)).toContain('Tomorrow');
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
