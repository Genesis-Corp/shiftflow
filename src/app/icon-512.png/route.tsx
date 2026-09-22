import { ImageResponse } from 'next/og';
import { AppIcon } from '@/lib/appIcon';

// radius=0 — see icon-192.png/route.tsx: this file is also declared
// "maskable", so the shape has to be Android's to crop, not ours.
export function GET() {
  return new ImageResponse(<AppIcon size={512} radius={0} />, { width: 512, height: 512 });
}
