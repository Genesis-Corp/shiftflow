'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Phone, Cake, Calendar, Briefcase, Archive, BellOff } from 'lucide-react';
import Modal from './Modal';
import ReliabilityBar from './ReliabilityBar';
import { fetchJson } from '@/lib/apiClient';
import { Staff, EmploymentType } from '@/lib/types';
import { formatAUMobile } from '@/lib/phone';
import { normalizeDeptColor } from '@/lib/deptColors';

const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  casual: 'Casual', part_time: 'Part-time', full_time: 'Full-time', salary: 'Salary',
};

/** "1998-09-18" -> "18 Sep" — the year on file only ever feeds age-bracket
 *  math, never shown here since a birthday recurs every year regardless. */
function formatBirthday(birthday: string): string {
  const [, month, day] = birthday.split('-').map(Number);
  return new Date(2000, month - 1, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function formatFullDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The shared "who is this" popup — a quick summary plus a link into the
 * full edit form, opened by StaffName wherever a staff member's name
 * appears. Always re-fetches by id rather than trusting whatever partial
 * staff object the calling page happened to have on hand, so it reads the
 * same regardless of which page it was opened from.
 */
export default function StaffSummaryModal({ staffId, onClose }: { staffId: string; onClose: () => void }) {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [error, setError] = useState('');
  const [clearingOptOut, setClearingOptOut] = useState(false);

  async function clearOptOut() {
    setClearingOptOut(true);
    try {
      const updated = await fetchJson<Staff>(`/api/staff/${staffId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sms_opt_out: false }),
      });
      setStaff(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear the opt-out.');
    } finally {
      setClearingOptOut(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setStaff(null);
    setError('');
    fetchJson<Staff>(`/api/staff/${staffId}`)
      .then(s => { if (!cancelled) setStaff(s); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load that staff member.'); });
    return () => { cancelled = true; };
  }, [staffId]);

  return (
    <Modal title={staff?.name ?? 'Staff member'} onClose={onClose}>
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : !staff ? (
        <div className="flex items-center justify-center py-10 text-slate-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={staff.age_group === 'senior' ? 'badge-blue' : 'badge-amber'}>
              {staff.age_group === 'senior' ? 'Senior' : 'Junior'}
            </span>
            <span className="badge-slate capitalize">{staff.role_type.replace(/_/g, ' ')}</span>
            <span className={staff.active ? 'badge-green' : 'badge-red'}>{staff.active ? 'Active' : 'Inactive'}</span>
            {staff.archived && (
              <span className="badge-red"><Archive size={11} className="mr-1" />Archived</span>
            )}
            {staff.sms_opt_out && (
              <span className="badge-red"><BellOff size={11} className="mr-1" />Opted out of SMS</span>
            )}
          </div>

          {staff.sms_opt_out && (
            <div className="rounded-md bg-red-50 border border-red-100 px-3 py-2 flex items-center justify-between gap-3">
              <p className="text-xs text-red-700">
                They texted STOP (or asked to stop getting texts) — logged as an incident (−30% reliability). They won&apos;t be offered any shift by SMS until this is cleared, or they text START themselves.
              </p>
              <button
                type="button"
                onClick={clearOptOut}
                disabled={clearingOptOut}
                className="btn-secondary text-xs whitespace-nowrap shrink-0"
              >
                {clearingOptOut ? 'Clearing…' : 'Re-enable SMS'}
              </button>
            </div>
          )}

          <div>
            <p className="label mb-1">Reliability</p>
            <ReliabilityBar score={staff.reliability_score} />
          </div>

          <div>
            <p className="label mb-1">Departments</p>
            {(staff.staff_departments ?? []).length === 0 ? (
              <p className="text-sm text-slate-400">Not trained in any department yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {(staff.staff_departments ?? []).map(sd => (
                  <span key={sd.department_id} className="badge-slate flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: normalizeDeptColor(sd.departments?.color) }} />
                    {sd.departments?.name ?? 'Unknown'}
                    {sd.training_level !== 'trained' && <span className="text-slate-400">({sd.training_level})</span>}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <div className="flex items-center gap-2 text-slate-600">
              <Phone size={14} className="text-slate-400 shrink-0" />
              {staff.phone_e164 ? formatAUMobile(staff.phone_e164) : <span className="text-slate-400">No mobile</span>}
            </div>
            {staff.birthday && (
              <div className="flex items-center gap-2 text-slate-600">
                <Cake size={14} className="text-slate-400 shrink-0" /> {formatBirthday(staff.birthday)}
              </div>
            )}
            {staff.employment_type && (
              <div className="flex items-center gap-2 text-slate-600">
                <Briefcase size={14} className="text-slate-400 shrink-0" /> {EMPLOYMENT_LABELS[staff.employment_type]}
              </div>
            )}
            {staff.commencement_date && (
              <div className="flex items-center gap-2 text-slate-600">
                <Calendar size={14} className="text-slate-400 shrink-0" /> Since {formatFullDate(staff.commencement_date)}
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2 border-t border-slate-100">
            <Link href={`/staff?edit=${staff.id}`} onClick={onClose} className="btn-primary">
              Edit staff member
            </Link>
          </div>
        </div>
      )}
    </Modal>
  );
}
