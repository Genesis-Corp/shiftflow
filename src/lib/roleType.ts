import { RoleType, TrainingLevel } from './types';

/**
 * Role type is derived automatically from department training levels — it
 * is never set by hand. "Advanced" counts the same as "trained" (it's a
 * stronger level of the same thing); "supervised" does not.
 *
 * - 3 or more departments at trained/advanced -> all-rounder.
 * - 1 or 2 departments at trained/advanced, with at least one other
 *   department still at supervised -> potential all-rounder (showing
 *   promise, but not yet fully cross-trained).
 * - Anything else (nothing trained, or trained departments with no
 *   supervised department alongside them) -> department-only.
 */
export function computeRoleType(departments: { training_level: TrainingLevel }[]): RoleType {
  const trainedCount = departments.filter(d => d.training_level === 'trained' || d.training_level === 'advanced').length;
  const supervisedCount = departments.filter(d => d.training_level === 'supervised').length;

  if (trainedCount >= 3) return 'all_rounder';
  if ((trainedCount === 1 || trainedCount === 2) && supervisedCount > 0) return 'potential_all_rounder';
  return 'department_only';
}
