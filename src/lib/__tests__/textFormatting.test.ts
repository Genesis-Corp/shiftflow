import { describe, it, expect } from 'vitest';
import { toBoldUnicode, toItalicUnicode, toUnderlineUnicode } from '../textFormatting';
import { isGsm7, smsSegments } from '../sms/templates';

describe('toBoldUnicode', () => {
  it('maps letters and digits to Mathematical Bold code points', () => {
    expect(toBoldUnicode('Ab9')).toBe('𝐀𝐛𝟗');
  });

  it('leaves punctuation and spaces untouched', () => {
    expect(toBoldUnicode('Hi, team!')).toBe('𝐇𝐢, 𝐭𝐞𝐚𝐦!');
  });

  it('forces UCS-2 encoding, roughly doubling the segment cost', () => {
    const plain = 'Staff meeting moved to 3pm today in the break room';
    const bold = toBoldUnicode(plain);
    expect(isGsm7(plain)).toBe(true);
    expect(isGsm7(bold)).toBe(false);
    expect(smsSegments(bold)).toBeGreaterThan(smsSegments(plain));
  });
});

describe('toItalicUnicode', () => {
  it('maps letters to Mathematical Italic code points', () => {
    expect(toItalicUnicode('Ab')).toBe('𝐴𝑏');
  });

  it('uses the Planck constant symbol for lowercase h, a known Unicode gap', () => {
    expect(toItalicUnicode('h')).toBe('ℎ');
  });

  it('leaves digits plain — Unicode has no italic digit block', () => {
    expect(toItalicUnicode('Room 9')).toBe('𝑅𝑜𝑜𝑚 9');
  });
});

describe('toUnderlineUnicode', () => {
  it('appends a combining low line after each character', () => {
    expect(toUnderlineUnicode('Hi')).toBe('H̲i̲');
  });

  it('does not underline newlines', () => {
    expect(toUnderlineUnicode('a\nb')).toBe('a̲\nb̲');
  });
});
