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

const BUSINESS = "Farmer Jack's";
const STAFF = 'Christopher';

describe('message templates', () => {
  it('trims the seconds Postgres returns on a time column', () => {
    expect(formatShiftTimes('09:00:00', '17:00:00')).toBe('09:00-17:00');
    expect(availabilityMessage(SHIFT, STAFF, BUSINESS)).not.toContain(':00:00');
  });

  it('keeps every short outcome message to a single SMS segment', () => {
    // At 161 GSM-7 characters the cost silently doubles.
    const messages = [
      winnerMessage(SHIFT, 'Christopher', BUSINESS),
      coveredMessage(SHIFT, BUSINESS),
      tooLateMessage(SHIFT, BUSINESS),
      declinedMessage(),
    ];
    for (const m of messages) {
      expect(smsSegments(m), `"${m}" (${m.length} chars)`).toBe(1);
    }
  });

  it('uses only GSM-7 characters, so no message drops to a 70-char segment', () => {
    expect(isGsm7(availabilityMessage(SHIFT, STAFF, BUSINESS))).toBe(true);
    expect(isGsm7(coveredMessage(SHIFT, BUSINESS))).toBe(true);
  });
});

describe('gather-tier and manager-pick messages', () => {
  const OPTIONS = [
    { option: 1, name: 'Alice', cost: 28.69 },
    { option: 2, name: 'Bob', cost: null },
  ];

  it('asks availability without a claim code or "first reply wins", but still offers an opt-out', () => {
    const msg = availabilityMessage(SHIFT, STAFF, BUSINESS);
    expect(msg).not.toContain('claim');
    expect(msg).not.toContain('first reply wins');
    expect(msg).toContain('YES or NO');
    expect(msg).toContain('STOP');
  });

  it('greets the staff member by name and identifies the business, with or without a manager', () => {
    const withManager = availabilityMessage(SHIFT, STAFF, BUSINESS, 'John');
    expect(withManager.startsWith(`Hey ${STAFF}, it's John from ${BUSINESS},`)).toBe(true);

    const withoutManager = availabilityMessage(SHIFT, STAFF, BUSINESS);
    expect(withoutManager.startsWith(`Hey ${STAFF}, it's ${BUSINESS},`)).toBe(true);

    const withNullManager = availabilityMessage(SHIFT, STAFF, BUSINESS, null);
    expect(withNullManager).toBe(withoutManager);
  });

  it('puts STOP before the YES/NO line, not last — so a phone\'s quick-reply suggestions favour YES/NO', () => {
    const msg = availabilityMessage(SHIFT, STAFF, BUSINESS, 'John');
    const lines = msg.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[2]).toBe('Reply STOP to opt out.');
    expect(lines[3]).toContain('Reply YES or NO');
  });

  it('says "we will confirm", never that the shift is already theirs', () => {
    const msg = availabilityMessage(SHIFT, STAFF, BUSINESS);
    expect(msg.toLowerCase()).not.toContain('yours');
    expect(msg).toContain('we will confirm the shift shortly after');
  });

  it('the immediate tier\'s urgent ask also carries no claim code but does offer an opt-out', () => {
    const msg = urgentAvailabilityMessage(SHIFT, false, STAFF, BUSINESS);
    expect(msg).not.toContain('claim');
    expect(msg).not.toContain('first reply wins');
    expect(msg).toContain('YES or NO');
    expect(msg).toContain('ASAP');
    expect(msg).toContain('STOP');

    const withName = urgentAvailabilityMessage(SHIFT, false, STAFF, BUSINESS, 'John');
    expect(withName.startsWith(`Hey ${STAFF}, it's John from ${BUSINESS},`)).toBe(true);
  });

  it('acknowledges a gather-tier yes without implying it won the shift', () => {
    const msg = availabilityAckMessage(BUSINESS);
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
      availabilityAckMessage(BUSINESS),
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

  it('the four-line availability ask costs 2 segments, not 1 — a deliberate tradeoff for readability', () => {
    // Four full sentences (sender ID, the ask, opt-out, what happens next)
    // don't fit in 160 GSM-7 chars. Documented here so the cost is visible
    // in the test suite rather than discovered by a phone bill.
    const msg = availabilityMessage(SHIFT, STAFF, BUSINESS, 'John');
    expect(isGsm7(msg)).toBe(true);
    expect(smsSegments(msg)).toBe(2);
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
    expect(availabilityMessage(SHIFT, STAFF, BUSINESS)).toContain('Today');
    expect(urgentAvailabilityMessage(SHIFT, false, STAFF, BUSINESS)).toContain('today');
  });

  it('reads "Tomorrow" when the shift is the day after the current date', () => {
    // Noon in Perth the day before the shift.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T04:00:00Z'));
    expect(availabilityMessage(SHIFT, STAFF, BUSINESS)).toContain('Tomorrow');
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
