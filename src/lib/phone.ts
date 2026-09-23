/**
 * Australian phone number handling.
 *
 * Every number that reaches the SMS layer must be E.164 (+614XXXXXXXX).
 * Numbers imported from the staff CSV arrive in local formats, so they are
 * normalised once on write and stored in `staff.phone_e164`.
 */

/** Australian mobile numbers in E.164: +61 4XX XXX XXX */
const AU_MOBILE_E164 = /^\+614\d{8}$/;

/**
 * Normalise an Australian mobile number to E.164, or return null if it isn't
 * a valid AU mobile. Accepts the formats the CSV import produces:
 *   0491570156 · 0491 570 156 · (04) 9157 0156 · +61 491 570 156
 *   61491570156 · 491570156
 */
export function toE164AU(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  // An explicit + means the caller already stated a country code. Honour it
  // rather than guessing, so a non-AU number fails loudly instead of being
  // silently rewritten into a different country's number space.
  if (trimmed.startsWith('+')) {
    const e164 = '+' + trimmed.slice(1).replace(/\D/g, '');
    return AU_MOBILE_E164.test(e164) ? e164 : null;
  }

  const digits = trimmed.replace(/\D/g, '');
  if (/^04\d{8}$/.test(digits))  return '+61' + digits.slice(1);  // 0491570156
  if (/^614\d{8}$/.test(digits)) return '+' + digits;             // 61491570156
  if (/^4\d{8}$/.test(digits))   return '+61' + digits;           // 491570156

  return null;
}

/** True if the string is already a valid AU mobile in E.164 form. */
export function isValidAUMobile(value: string | null | undefined): boolean {
  return !!value && AU_MOBILE_E164.test(value);
}

/** Display an E.164 AU mobile as 0491 570 156. Falls back to the input. */
export function formatAUMobile(e164: string | null | undefined): string {
  if (!isValidAUMobile(e164)) return e164 ?? '';
  const local = '0' + e164!.slice(3);                    // +61491570156 -> 0491570156
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

/**
 * Parse an allowlist env var into E.164 numbers.
 *
 * Entries are separated by commas, semicolons or newlines — NOT by spaces.
 * People write "+61 491 570 156" in a config value, and splitting on
 * whitespace would turn that one number into four meaningless entries and an
 * allowlist that matches nothing.
 */
export function parseNumberList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,;\n]+/)
    .map(v => v.trim())
    .filter(Boolean)
    .map(v => (v.startsWith('+') ? '+' + v.slice(1).replace(/\D/g, '') : v.replace(/\s/g, '')));
}
