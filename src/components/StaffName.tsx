'use client';

import { useStaffModal } from './StaffModalProvider';

/**
 * A staff member's name, rendered as the one click target for the shared
 * summary modal — used in place of a plain <span>/<td> wherever a real
 * staff record's name is displayed, so every page gets the same behaviour.
 */
export default function StaffName({
  staffId, name, className,
}: {
  staffId: string;
  name: string;
  className?: string;
}) {
  const { openStaff } = useStaffModal();
  return (
    <button
      type="button"
      onClick={() => openStaff(staffId)}
      className={`${className ?? ''} text-left hover:text-blue-600 hover:underline transition-colors`.trim()}
    >
      {name}
    </button>
  );
}
