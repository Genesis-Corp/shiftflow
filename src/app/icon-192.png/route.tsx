import { ImageResponse } from 'next/og';
import { AppIcon } from '@/lib/appIcon';

// A plain route rather than the icon.tsx/apple-icon.tsx convention: those
// two are fixed to the sizes browsers ask for automatically (favicon,
// iOS home screen), but the PWA manifest below needs specific declared
// sizes of its own for Android/Chrome's install prompt to treat the app as
// a real installable icon set rather than falling back to a screenshot.
// radius=0: this file is also declared "maskable" in the manifest, where
// Android crops its own shape (circle, squircle, rounded square…) out of
// the full square — a self-rounded source would leave a visible mismatch
// at the corners under whichever mask the launcher picks.
export function GET() {
  return new ImageResponse(<AppIcon size={192} radius={0} />, { width: 192, height: 192 });
}
