/**
 * "Bold" / "italic" / "underline" toolbar support for the Message Board
 * textarea.
 *
 * SMS has no native rich text — there is no such thing as a bold or
 * underlined text message. Mathematical Alphanumeric Symbol code points
 * (Unicode's U+1D400 block) are genuinely different *characters* that happen
 * to render as bold/italic glyphs on any modern phone, so the toolbar swaps
 * selected plain ASCII letters/digits for their bold/italic counterparts
 * directly in the textarea — what's typed is exactly what arrives, no hidden
 * markup. There is no dedicated underline code point; the closest is the
 * combining low line (U+0332) stitched after every character, which some
 * older or feature phones render as broken boxes instead of an underscore —
 * callers should warn about that rather than present it as equally safe.
 *
 * Also note: any character outside the GSM-7 alphabet forces the whole SMS
 * into UCS-2 encoding — 70 chars/segment instead of 160 (see
 * smsSegments() in sms/templates.ts) — so a message using any of this
 * formatting costs roughly double the segments of the same plain text.
 */

function mapLetterAndMaybeDigit(
  ch: string,
  upperStart: number,
  lowerStart: number,
  digitStart: number | null
): string {
  const code = ch.codePointAt(0)!;
  if (code >= 65 && code <= 90) return String.fromCodePoint(upperStart + (code - 65));
  if (code >= 97 && code <= 122) return String.fromCodePoint(lowerStart + (code - 97));
  if (digitStart !== null && code >= 48 && code <= 57) return String.fromCodePoint(digitStart + (code - 48));
  return ch;
}

/** Mathematical Bold — letters and digits both have dedicated code points. */
export function toBoldUnicode(text: string): string {
  return [...text].map(ch => mapLetterAndMaybeDigit(ch, 0x1d400, 0x1d41a, 0x1d7ce)).join('');
}

/** Mathematical Italic — no italic digits exist in Unicode, so they're left
 *  plain; lowercase h has no dedicated code point either (U+1D455 was never
 *  assigned) and uses the Planck constant symbol ℎ (U+210E) instead, a
 *  well-known quirk of this Unicode block. */
export function toItalicUnicode(text: string): string {
  return [...text].map(ch => {
    if (ch === 'h') return 'ℎ';
    return mapLetterAndMaybeDigit(ch, 0x1d434, 0x1d44e, null);
  }).join('');
}

/** Combining low line after every non-newline character. */
export function toUnderlineUnicode(text: string): string {
  return [...text].map(ch => (ch === '\n' ? ch : ch + '̲')).join('');
}
