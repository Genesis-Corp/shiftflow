import { parseNumberList } from '@/lib/phone';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export type SmsMode = 'console' | 'redirect' | 'live';

/**
 * SMS configuration, read from the environment on every call so that a change
 * in Vercel takes effect on the next request rather than needing a cold start.
 *
 * SMS_MODE is the master safety switch:
 *   console  — nothing is sent. Messages are logged to sms_messages only.
 *   redirect — really sent via Twilio, but every recipient is rewritten to
 *              SMS_TEST_NUMBER and the body is prefixed with who it was for.
 *   live     — sent to the real staff member.
 */
export function getSmsMode(): SmsMode {
  const raw = (process.env.SMS_MODE ?? 'console').trim().toLowerCase();
  if (raw === 'live' || raw === 'redirect' || raw === 'console') return raw;
  // An unrecognised value must never mean "live".
  console.warn(`[sms] Unrecognised SMS_MODE "${raw}" — falling back to console.`);
  return 'console';
}

export function getTestNumber(): string | null {
  return process.env.SMS_TEST_NUMBER?.trim() || null;
}

/**
 * Numbers that may receive messages. Enforced in EVERY mode, including live.
 * An empty allowlist means "no restriction" — which is what going live looks
 * like, so it must be cleared deliberately.
 */
export function getAllowlist(): string[] {
  return parseNumberList(process.env.SMS_ALLOWLIST);
}

export function getTimezone(): string {
  return process.env.APP_TIMEZONE?.trim() || 'Australia/Perth';
}

export function getExpiryMinutes(): number {
  const n = Number(process.env.CLAIM_RACE_EXPIRY_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

export function getMaxRecipients(): number {
  const n = Number(process.env.SMS_MAX_RECIPIENTS);
  return Number.isFinite(n) && n > 0 ? n : 25;
}

/** Parsed SMS_QUIET_HOURS, e.g. "21:00-07:00". Null when unset. Only a
 *  fallback now, for before the store has saved a quiet-hours window of
 *  their own in Settings — see getQuietHours() below. */
function getQuietHoursFromEnv(): { start: string; end: string } | null {
  const raw = process.env.SMS_QUIET_HOURS?.trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);
  if (!m) {
    console.warn(`[sms] Ignoring malformed SMS_QUIET_HOURS "${raw}" (expected "21:00-07:00").`);
    return null;
  }
  return { start: m[1], end: m[2] };
}

/**
 * The store's own quiet-hours window (Settings → SMS Quiet Hours) — set by
 * whoever runs the store, not a developer, since what counts as "too early"
 * varies store to store and can change. Falls back to SMS_QUIET_HOURS until
 * the store has saved one of their own. Null means no quiet hours at all.
 */
export async function getQuietHours(): Promise<{ start: string; end: string } | null> {
  const { data } = await supabaseAdmin
    .from('store_settings')
    .select('quiet_hours_start, quiet_hours_end')
    .eq('id', 'current')
    .maybeSingle();

  if (data?.quiet_hours_start && data?.quiet_hours_end) {
    return { start: data.quiet_hours_start.slice(0, 5), end: data.quiet_hours_end.slice(0, 5) };
  }
  return getQuietHoursFromEnv();
}

/**
 * The store's own name (Settings → Store name), used to identify the sender
 * on every staff-facing text — the Spam Act 2003 requires it. Falls back to
 * SMS_BUSINESS_NAME until the store has saved one of their own, then to a
 * generic default, so a fresh deployment never sends an unbranded text.
 */
export async function getBusinessName(): Promise<string> {
  const { data } = await supabaseAdmin
    .from('store_settings')
    .select('business_name')
    .eq('id', 'current')
    .maybeSingle();

  if (data?.business_name?.trim()) return data.business_name.trim();
  return process.env.SMS_BUSINESS_NAME?.trim() || 'Your Store';
}

/** Current wall-clock time in the configured timezone, as "HH:MM". */
export function localTimeNow(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: getTimezone(), hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now);
}

/** Current calendar date in the configured timezone, as "YYYY-MM-DD". */
export function localDateNow(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: getTimezone(), year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/**
 * Whether we are currently inside the configured quiet hours. Windows that
 * wrap past midnight (21:00-07:00) are handled.
 */
export async function isQuietHours(now: Date = new Date()): Promise<boolean> {
  const window = await getQuietHours();
  if (!window) return false;
  const t = localTimeNow(now);
  return window.start <= window.end
    ? t >= window.start && t < window.end
    : t >= window.start || t < window.end;
}
