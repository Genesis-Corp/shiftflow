import { ImageResponse } from 'next/og';
import { AppIcon } from '@/lib/appIcon';

// iOS applies its own corner mask on top of whatever's here, so this is
// drawn as a full square — a rounded one would show a visible seam.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(<AppIcon size={180} radius={0} />, size);
}
