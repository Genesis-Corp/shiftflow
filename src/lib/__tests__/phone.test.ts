import { describe, it, expect } from 'vitest';
import { toE164AU, isValidAUMobile, formatAUMobile, parseNumberList } from '../phone';

describe('toE164AU', () => {
  it('normalises the formats the staff CSV produces', () => {
    expect(toE164AU('0491570156')).toBe('+61491570156');
    expect(toE164AU('0491 570 156')).toBe('+61491570156');
    expect(toE164AU('0491-570-156')).toBe('+61491570156');
    expect(toE164AU('(04) 9157 0156')).toBe('+61491570156');
    expect(toE164AU('+61 491 570 156')).toBe('+61491570156');
    expect(toE164AU('61491570156')).toBe('+61491570156');
    expect(toE164AU('491570156')).toBe('+61491570156');
    expect(toE164AU('  0491570156  ')).toBe('+61491570156');
  });

  it('rejects anything that is not an AU mobile', () => {
    expect(toE164AU(null)).toBeNull();
    expect(toE164AU('')).toBeNull();
    expect(toE164AU('not a phone')).toBeNull();
    expect(toE164AU('0491570')).toBeNull();          // too short
    expect(toE164AU('0491570156123')).toBeNull();    // too long
    expect(toE164AU('0862345678')).toBeNull();       // Perth landline, no SMS
    expect(toE164AU('+6412345678')).toBeNull();      // wrong length
  });

  it('does not silently rewrite a foreign number into AU', () => {
    // A UK mobile must fail loudly rather than become a different AU number.
    expect(toE164AU('+447911123456')).toBeNull();
    expect(toE164AU('+12125551234')).toBeNull();
  });
});

describe('isValidAUMobile / formatAUMobile', () => {
  it('validates E.164 AU mobiles', () => {
    expect(isValidAUMobile('+61491570156')).toBe(true);
    expect(isValidAUMobile('0491570156')).toBe(false);
    expect(isValidAUMobile(null)).toBe(false);
  });

  it('formats for display', () => {
    expect(formatAUMobile('+61491570156')).toBe('0491 570 156');
  });
});

describe('parseNumberList', () => {
  it('parses an allowlist env var', () => {
    expect(parseNumberList('+61491570156, +61400000000')).toEqual(
      ['+61491570156', '+61400000000']);
    expect(parseNumberList(undefined)).toEqual([]);
    expect(parseNumberList('')).toEqual([]);
  });

  it('keeps a spaced number as one entry', () => {
    // Splitting on whitespace here would produce four junk entries and an
    // allowlist that silently matches nothing.
    expect(parseNumberList('+61 491 570 156')).toEqual(['+61491570156']);
    expect(parseNumberList('+61 491 570 156, +61 400 000 000'))
      .toEqual(['+61491570156', '+61400000000']);
    expect(parseNumberList('+61491570156\n+61400000000'))
      .toEqual(['+61491570156', '+61400000000']);
  });
});
