'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import StaffSummaryModal from './StaffSummaryModal';

interface StaffModalContextValue {
  openStaff: (staffId: string) => void;
}

const StaffModalContext = createContext<StaffModalContextValue | null>(null);

/**
 * Wherever a staff member's name is shown, clicking it opens the same
 * summary modal — mounted once here at the root so every page shares one
 * instance (via useStaffModal/StaffName) instead of each page building its
 * own copy of this.
 */
export default function StaffModalProvider({ children }: { children: React.ReactNode }) {
  const [staffId, setStaffId] = useState<string | null>(null);

  const openStaff = useCallback((id: string) => setStaffId(id), []);
  const close = useCallback(() => setStaffId(null), []);

  return (
    <StaffModalContext.Provider value={{ openStaff }}>
      {children}
      {staffId && <StaffSummaryModal staffId={staffId} onClose={close} />}
    </StaffModalContext.Provider>
  );
}

export function useStaffModal(): StaffModalContextValue {
  const ctx = useContext(StaffModalContext);
  if (!ctx) throw new Error('useStaffModal must be used within StaffModalProvider');
  return ctx;
}
