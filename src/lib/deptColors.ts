/**
 * A department's color is any hex value the manager picks, not a fixed
 * palette — the Shifts roster (List and Daily Timeline) needs one per
 * department and a store can easily have more departments than any small
 * preset covers. Rendered via inline styles rather than Tailwind classes,
 * since the color is only known at runtime.
 */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Quick-pick swatches shown alongside the custom hex picker — a starting
 *  point, not a limit. Also what new departments cycle through by default. */
export const PRESET_DEPARTMENT_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#a855f7', // purple
  '#14b8a6', // teal
  '#ec4899', // pink
  '#6366f1', // indigo
  '#06b6d4', // cyan
  '#f97316', // orange
  '#f43f5e', // rose
  '#84cc16', // lime
  '#d946ef', // fuchsia
];

const DEFAULT_COLOR = '#64748b'; // slate-500

// Departments created before the hex picker stored one of these names —
// mapped here so they keep showing a sensible color instead of falling
// back to the default the moment this shipped.
const LEGACY_NAMES: Record<string, string> = {
  blue: '#3b82f6', green: '#22c55e', amber: '#f59e0b', purple: '#a855f7',
  teal: '#14b8a6', pink: '#ec4899', indigo: '#6366f1', cyan: '#06b6d4',
  orange: '#f97316', rose: '#f43f5e',
};

/** A department's color, coerced to a valid hex string. */
export function normalizeDeptColor(color: string | null | undefined): string {
  if (color && HEX_RE.test(color)) return color;
  if (color && LEGACY_NAMES[color]) return LEGACY_NAMES[color];
  return DEFAULT_COLOR;
}

/** Cycle through the presets so each new department starts out visually distinct. */
export function autoDeptColor(existingCount: number): string {
  return PRESET_DEPARTMENT_COLORS[existingCount % PRESET_DEPARTMENT_COLORS.length];
}

/** Black or white, whichever reads better on this background. */
export function deptTextColor(color: string | null | undefined): string {
  const hex = normalizeDeptColor(color);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#0f172a' : '#ffffff';
}
