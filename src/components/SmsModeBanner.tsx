'use client';

import { FlaskConical, Terminal } from 'lucide-react';
import { SmsConfig } from '@/lib/types';

/**
 * Always-visible reminder of which SMS mode is active. A test race must never
 * be mistaken for a real one, and vice versa.
 */
export default function SmsModeBanner({ config }: { config: SmsConfig | null }) {
  if (!config) return null;

  // Live mode is the normal running state now, not a thing to flag — the
  // banner stays for redirect/console so a test race is never mistaken for
  // a real one, but a real one no longer announces itself as an anomaly.
  if (config.mode === 'live') return null;

  if (config.mode === 'redirect') {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 flex items-center gap-2 text-sm text-amber-900">
        <FlaskConical size={15} className="flex-shrink-0" />
        <span>
          <strong>TEST MODE (redirect)</strong> — real texts are sent, but every one goes to{' '}
          <strong>{config.test_number}</strong>, never to staff. Each is prefixed with its
          intended recipient.
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-300 bg-slate-100 px-4 py-2.5 flex items-center gap-2 text-sm text-slate-700">
      <Terminal size={15} className="flex-shrink-0" />
      <span>
        <strong>CONSOLE MODE</strong> — no texts are sent anywhere. Messages are logged
        below and you can simulate replies.
      </span>
    </div>
  );
}
