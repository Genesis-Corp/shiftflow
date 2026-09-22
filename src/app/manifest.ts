import { MetadataRoute } from 'next';

/**
 * Lets a manager add ShiftFlow to their home screen and open it full-screen,
 * no browser chrome — Next serves this at /manifest.webmanifest and links
 * it automatically. iOS ignores most of this (it reads apple-icon.tsx and
 * the apple-mobile-web-app-* meta tags in layout.tsx instead), but Android
 * and desktop Chrome's install prompt both read it directly.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ShiftFlow — Farmer Jack's",
    short_name: 'ShiftFlow',
    description: 'Supermarket shift cover management',
    start_url: '/',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#1d4ed8',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
