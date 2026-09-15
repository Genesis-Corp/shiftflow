'use client';

import { FlaskConical, Radio, Terminal } from 'lucide-react';
import { SmsConfig } from '@/lib/types';

/**
 * Always-visible reminder of which SMS mode is active. A test race must never
 * be mistaken for a real one, and vice versa.
 */
export default function SmsModeBanner({ config }: { config: SmsConfig | null }) {
  if (!config) return null;

  if (config.mode === 'live') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 flex items-center gap-2 text-sm text-red-800">
        <Radio size={15} className="flex-shrink-0" />
        <span>
          <strong>LIVE MODE</strong> — messages go to real staff mobiles.
          {config.allowlist_size > 0 &&
            ` Restricted to ${config.allowlist_size} allowlisted number(s).`}
        </span>
      </div>
    );
  }

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
