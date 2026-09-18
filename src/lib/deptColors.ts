/**
 * The palette a department's color is picked from, for the Shifts roster
 * (List and Daily Timeline). Written out per-color rather than built from a
 * template string so Tailwind's scanner — which only sees literal class
 * names, not `bg-${color}-500` — can find every one of them.
 */
export const DEPARTMENT_COLORS = [
  'blue', 'green', 'amber', 'purple', 'teal', 'pink', 'indigo', 'cyan', 'orange', 'rose',
] as const;

export type DepartmentColor = typeof DEPARTMENT_COLORS[number];

const BADGE: Record<DepartmentColor, string> = {
  blue: 'bg-blue-100 text-blue-800',
  green: 'bg-green-100 text-green-800',
  amber: 'bg-amber-100 text-amber-800',
  purple: 'bg-purple-100 text-purple-800',
  teal: 'bg-teal-100 text-teal-800',
  pink: 'bg-pink-100 text-pink-800',
  indigo: 'bg-indigo-100 text-indigo-800',
  cyan: 'bg-cyan-100 text-cyan-800',
  orange: 'bg-orange-100 text-orange-800',
  rose: 'bg-rose-100 text-rose-800',
};

const SOLID: Record<DepartmentColor, string> = {
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  amber: 'bg-amber-500',
  purple: 'bg-purple-500',
  teal: 'bg-teal-500',
  pink: 'bg-pink-500',
  indigo: 'bg-indigo-500',
  cyan: 'bg-cyan-500',
  orange: 'bg-orange-500',
  rose: 'bg-rose-500',
};

const BORDER: Record<DepartmentColor, string> = {
  blue: 'border-blue-400',
  green: 'border-green-400',
  amber: 'border-amber-400',
  purple: 'border-purple-400',
  teal: 'border-teal-400',
  pink: 'border-pink-400',
  indigo: 'border-indigo-400',
  cyan: 'border-cyan-400',
  orange: 'border-orange-400',
  rose: 'border-rose-400',
};

function deptColorKey(color: string | null | undefined): DepartmentColor {
  return (DEPARTMENT_COLORS as readonly string[]).includes(color ?? '')
    ? (color as DepartmentColor)
    : 'blue';
}

/** Badge classes (light background, dark text) for a department chip. */
export function deptBadgeClass(color: string | null | undefined): string {
  return BADGE[deptColorKey(color)];
}

/** Solid classes for a dot or bar. */
export function deptSolidClass(color: string | null | undefined): string {
  return SOLID[deptColorKey(color)];
}

/** Left-border accent for a grouped section header. */
export function deptBorderClass(color: string | null | undefined): string {
  return BORDER[deptColorKey(color)];
}

/** Cycle through the palette so each new department starts out visually distinct. */
export function autoDeptColor(existingCount: number): DepartmentColor {
  return DEPARTMENT_COLORS[existingCount % DEPARTMENT_COLORS.length];
}
