import { describe, it, expect } from 'vitest';
import { parseManagerReply, allocateOptionNumber, MAX_OPTION_NUMBER } from '../managerReply';
import {
  availabilityMessage, urgentAvailabilityMessage, acceptedMessage, notSelectedMessage,
  managerOptionMessage, managerListMessage, managerEscalationMessage, smsSegments, isGsm7,
} from '../sms/templates';

const SHIFT = {
  date: '2026-09-18', start_time: '09:00:00', end_time: '17:00:00', departmentName: 'Checkout',
};

describe('parseManagerReply', () => {
  it('reads a bare number as a pick', () => {
    expect(parseManagerReply('2')).toEqual({ kind: 'select', option: 2 });
  });

  it('reads a number out of a chatty reply', () => {
    expect(parseManagerReply('pick 3 please')).toEqual({ kind: 'select', option: 3 });
    expect(parseManagerReply('#4')).toEqual({ kind: 'select', option: 4 });
    expect(parseManagerReply('  7  ')).toEqual({ kind: 'select', option: 7 });
  });

  it('prefers a number over a yes, since the number is more specific', () => {
    expect(parseManagerReply('yes 2')).toEqual({ kind: 'select', option: 2 });
  });

  it('refuses to guess when two numbers appear', () => {
    // Guessing here would hand the shift to the wrong person.
    expect(parseManagerReply('call at 3 or 4')).toEqual({ kind: 'unknown' });
  });

  it('reads approval of a senior wave', () => {
    expect(parseManagerReply('yes')).toEqual({ kind: 'approve' });
    expect(parseManagerReply('Yes please')).toEqual({ kind: 'approve' });
    expect(parseManagerReply('ok')).toEqual({ kind: 'approve' });
  });

  it('reads a decline', () => {
    expect(parseManagerReply('no')).toEqual({ kind: 'decline' });
    expect(parseManagerReply('Nah leave it')).toEqual({ kind: 'decline' });
  });

  it('is unknown for anything it cannot place', () => {
    expect(parseManagerReply('what shift?')).toEqual({ kind: 'unknown' });
    expect(parseManagerReply('')).toEqual({ kind: 'unknown' });
  });

  it('ignores a zero rather than treating it as an option', () => {
    expect(parseManagerReply('0')).toEqual({ kind: 'unknown' });
  });
});

describe('allocateOptionNumber', () => {
  it('starts at 1 when nothing is open', () => {
    expect(allocateOptionNumber([])).toBe(1);
  });

  it('counts up rather than filling a gap, so a number never changes meaning', () => {
    // 2 was freed when its request closed, but she may still reply to it.
    expect(allocateOptionNumber([1, 3])).toBe(4);
  });

  it('keeps numbering across two cover requests running at once', () => {
    expect(allocateOptionNumber([1, 2, 3])).toBe(4);
  });

  it('wraps to the lowest free number only once it runs past the cap', () => {
    const taken = Array.from({ length: MAX_OPTION_NUMBER }, (_, i) => i + 1).filter(n => n !== 5);
    expect(allocateOptionNumber(taken)).toBe(5);
  });
});

describe('availability flow copy', () => {
  it('asks about availability without offering the shift or a claim code', () => {
    const msg = availabilityMessage(SHIFT);
    expect(msg).toContain('are you available');
    expect(msg).toContain('Checkout');
    expect(msg).not.toMatch(/first reply wins/i);
    expect(msg).not.toMatch(/STOP/);
    expect(msg).not.toMatch(/claim/i);
  });

  it('says somebody is needed now in the no-show case', () => {
    expect(urgentAvailabilityMessage(SHIFT, false)).toContain('ASAP');
    expect(urgentAvailabilityMessage(SHIFT, false)).toContain('today');
  });

  it('says "tonight" instead of "today" once asked for after 5pm', () => {
    expect(urgentAvailabilityMessage(SHIFT, true)).toContain('tonight');
    expect(urgentAvailabilityMessage(SHIFT, true)).not.toContain('today');
  });

  it('opens with the starting manager\'s name, same as the other tiers', () => {
    const withName = urgentAvailabilityMessage(SHIFT, false, 'John');
    expect(withName.startsWith("Hey it's John - ")).toBe(true);
    expect(urgentAvailabilityMessage(SHIFT, false).startsWith("Hey it's")).toBe(false);
  });

  it('uses the wording the store manager asked for', () => {
    expect(acceptedMessage()).toContain('thank you for accepting the shift, see you soon!');
    expect(notSelectedMessage()).toContain('unfortunately it has been covered');
  });

  it('keeps every staff-facing message to one segment', () => {
    for (const m of [
      availabilityMessage(SHIFT), urgentAvailabilityMessage(SHIFT, false), urgentAvailabilityMessage(SHIFT, true),
      acceptedMessage(), notSelectedMessage(),
    ]) {
      expect(smsSegments(m), `"${m}" (${m.length} chars)`).toBe(1);
      expect(isGsm7(m), `"${m}" has a non-GSM character`).toBe(true);
    }
  });
});

describe('manager copy', () => {
  it('gives each option a number to reply with', () => {
    const msg = managerOptionMessage(SHIFT, 'Jai Black', 184.5, 3);
    expect(msg).toContain('Jai Black');
    expect(msg).toContain('$184.50');
    expect(msg).toContain('Reply 3');
  });

  it('says so plainly when somebody has no rate set', () => {
    expect(managerOptionMessage(SHIFT, 'Jai Black', null, 1)).toContain('no rate set');
  });

  it('lists everyone with their number when the window closes', () => {
    const msg = managerListMessage(SHIFT, [
      { option: 1, name: 'Jai Black', cost: 184.5 },
      { option: 2, name: 'Umme Habiba', cost: 201 },
    ]);
    expect(msg).toContain('1. Jai Black - $184.50');
    expect(msg).toContain('2. Umme Habiba - $201.00');
  });

  it('says nobody is available rather than sending an empty list', () => {
    expect(managerListMessage(SHIFT, [])).toContain('nobody is available');
  });

  it('asks before widening a junior shift to seniors', () => {
    const msg = managerEscalationMessage(SHIFT);
    expect(msg).toContain('no junior staff available');
    expect(msg).toContain('Reply YES');
  });
});
