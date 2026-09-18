import { NextResponse } from 'next/server';
import { getSmsMode, getTestNumber, getAllowlist, getTimezone, getExpiryMinutes, isQuietHours } from '@/lib/sms/config';
import { requireUser, unauthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Non-secret SMS settings, so the UI can show an accurate mode banner and
 * decide whether to offer the reply simulator. Never returns credentials.
 */
export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();

  const mode = getSmsMode();
  return NextResponse.json({
    mode,
    test_number: mode === 'redirect' ? getTestNumber() : null,
    allowlist_size: getAllowlist().length,
    timezone: getTimezone(),
    expiry_minutes: getExpiryMinutes(),
    quiet_hours_now: await isQuietHours(),
    simulation_enabled: mode !== 'live',
  });
}
