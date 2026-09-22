/**
 * GSM-7 / segment-cost math — pulled out of templates.ts so it can be
 * imported from client components (the Message Board's live character
 * counter) without dragging in sms/config.ts, which imports supabaseAdmin
 * (the service-role client) and must never reach the browser bundle.
 *
 * No imports of its own: keep it that way.
 */

/** Characters that are NOT in the GSM-7 alphabet force a 70-char UCS-2 segment. */
const GSM7 =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENDED = '^{}\\[~]|€';

export function isGsm7(text: string): boolean {
  return [...text].every(c => GSM7.includes(c) || GSM7_EXTENDED.includes(c));
}

/** How many SMS segments this body will cost. */
export function smsSegments(text: string): number {
  if (!isGsm7(text)) {
    return text.length <= 70 ? 1 : Math.ceil(text.length / 67);
  }
  // Extended characters occupy two septets each.
  const septets = [...text].reduce(
    (n, c) => n + (GSM7_EXTENDED.includes(c) ? 2 : 1), 0
  );
  return septets <= 160 ? 1 : Math.ceil(septets / 153);
}
