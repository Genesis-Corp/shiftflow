/**
 * Shared drawing for every generated app icon (favicon, apple-touch-icon,
 * the two PWA manifest sizes) — one definition so they can never drift out
 * of sync with each other or with the navbar's own ⚡ mark. The bolt path is
 * lucide-react's "zap" glyph, the same icon set the rest of the app uses.
 */
const ZAP_PATH = 'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z';

/** blue-700, the navbar's own background color. */
const BRAND_BLUE = '#1d4ed8';

export function AppIcon({ size, radius = size * 0.22 }: { size: number; radius?: number }) {
  // The bolt is drawn at lucide's native 24x24 grid, scaled up with a small
  // inset so it reads clearly even shrunk to a 16px browser tab.
  const inset = size * 0.18;
  const boltSize = size - inset * 2;

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: BRAND_BLUE,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width={boltSize} height={boltSize} viewBox="0 0 24 24" fill="white">
        <path d={ZAP_PATH} />
      </svg>
    </div>
  );
}
