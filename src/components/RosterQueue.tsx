'use client';

import { ChevronDown, ChevronLeft, ChevronRight, Loader2, Check, AlertTriangle, X } from 'lucide-react';
import { useState } from 'react';
import Modal from '@/components/Modal';
import { Department } from '@/lib/types';
import { RosterJob } from '@/lib/roster';
import type { RosterPlan } from '@/app/api/import-roster/route';
import { formatDate, RELIABILITY_DELTAS } from '@/lib/shiftUtils';

interface Props {
  jobs: RosterJob[];
  departments: Department[];
  applying: string | null;
  onClose: () => void;
  onChangeTarget: (id: string, date: string, departmentId: string) => void;
  onToggleNoShows: (id: string, value: boolean) => void;
  onApply: (id: string) => void;
  onApplyAll: () => void;
  onRemove: (id: string) => void;
}

/**
 * The queue of roster photos.
 *
 * Every photo is its own day and department, so each row carries its own date
 * and department and is added on its own. Reading happens one photo at a time
 * in the background, so a row can be checked while the next is still being read.
 */
export default function RosterQueue({
  jobs, departments, applying, onClose, onChangeTarget, onToggleNoShows, onApply, onApplyAll, onRemove,
}: Props) {
  const [open, setOpen] = useState<string | null>(null);

  const ready = jobs.filter(j => j.status === 'ready');
  const working = jobs.some(j => j.status === 'pending' || j.status === 'reading');

  return (
    <Modal title={jobs.length === 1 ? 'Roster from screenshot' : `${jobs.length} rosters`} onClose={onClose} size="lg">
      <div className="space-y-3 text-sm">
        {working && (
          <p className="text-xs text-slate-500">
            Reading the photos one at a time — each is its own upload, so a long batch cannot time out. You can check the
            ones that are done while the rest finish.
          </p>
        )}

        {jobs.map(job => {
          const plan = job.plan as RosterPlan | undefined;
          const expanded = open === job.id;
          const department = departments.find(d => d.id === job.department_id);

          return (
            <div key={job.id} className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-slate-50">
                <StatusIcon status={job.status} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 truncate">
                    {/* Until a photo is read it has no department or date — show what was picked. */}
                    {job.status === 'ready' || job.status === 'applied'
                      ? `${department?.name ?? 'No department'} · ${formatDate(job.date)}`
                      : job.name}
                  </p>
                  <p className="text-xs text-slate-400 truncate">
                    {job.status === 'reading' && 'Reading…'}
                    {job.status === 'pending' && 'Waiting'}
                    {job.status === 'failed' && (job.error ?? 'Could not be read')}
                    {job.status === 'applied' && `${job.applied?.shifts_created ?? 0} shift${job.applied?.shifts_created === 1 ? '' : 's'} added`}
                    {job.status === 'ready' && plan && summarise(plan)}
                  </p>
                </div>

                {job.status === 'ready' && (
                  <button onClick={() => setOpen(expanded ? null : job.id)} className="btn-ghost p-1.5" aria-label={expanded ? 'Hide details' : 'Show details'}>
                    <ChevronDown size={16} className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'} />
                  </button>
                )}
                {job.status !== 'applied' && job.status !== 'reading' && (
                  <button onClick={() => onRemove(job.id)} className="btn-ghost p-1.5 text-slate-400" aria-label={`Remove ${job.name}`}>
                    <X size={15} />
                  </button>
                )}
              </div>

              {expanded && plan && (
                <div className="p-3 space-y-3 border-t border-slate-100">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="label">Date of this roster</label>
                      <div className="flex gap-1">
                        <button onClick={() => onChangeTarget(job.id, shiftDate(job.date, -1), job.department_id)} className="btn-secondary px-2" aria-label="Day before"><ChevronLeft size={15} /></button>
                        <input type="date" className="input flex-1" value={job.date} onChange={e => onChangeTarget(job.id, e.target.value, job.department_id)} />
                        <button onClick={() => onChangeTarget(job.id, shiftDate(job.date, 1), job.department_id)} className="btn-secondary px-2" aria-label="Day after"><ChevronRight size={15} /></button>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">{formatDate(job.date)}</p>
                    </div>
                    <div>
                      <label className="label">Department</label>
                      <select className="input" value={job.department_id} onChange={e => onChangeTarget(job.id, job.date, e.target.value)}>
                        {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                      {job.heading && (
                        <p className={`text-xs mt-1 ${job.heading.matched ? 'text-slate-500' : 'text-amber-700'}`}>
                          {job.heading.matched
                            ? `Matched from the heading "${job.heading.text}".`
                            : `The heading says "${job.heading.text}", which is not one of your departments — check this is the right one.`}
                        </p>
                      )}
                    </div>
                  </div>

                  {plan.existingOnDate > 0 && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                      <p className="text-xs text-blue-900">
                        {department?.name} already has {plan.existingOnDate} shift{plan.existingOnDate === 1 ? '' : 's'} on {formatDate(job.date)}.
                        {' '}If this photo is for a different day, change the date above before adding it.
                      </p>
                    </div>
                  )}

                  {plan.creates.length > 0 && (
                    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                      {plan.creates.map(shift => (
                        <li key={shift.staff_id} className="px-3 py-2 flex items-center justify-between gap-2">
                          <span className="font-medium text-slate-700 truncate">{shift.name}</span>
                          <span className="text-xs text-slate-500 shrink-0">
                            {shift.start_time.slice(0, 5)}–{shift.end_time.slice(0, 5)}
                            {shift.has_break && <span className="text-slate-400"> · break</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {plan.noShows.length > 0 && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                      <p className="text-xs font-semibold text-red-800">Marked as a no-show: {plan.noShows.map(n => n.name).join(', ')}</p>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input type="checkbox" checked={job.logNoShows} onChange={e => onToggleNoShows(job.id, e.target.checked)} className="mt-0.5 accent-red-600" />
                        <span className="text-xs text-red-800">
                          Also log this against their reliability, which lowers their score by {Math.abs(RELIABILITY_DELTAS.no_show)} points each.
                        </span>
                      </label>
                    </div>
                  )}

                  {plan.duplicates.length > 0 && (
                    <p className="text-xs text-slate-500">
                      Already on this date, unchanged: {plan.duplicates.map(d => `${d.name} (${d.existing})`).join(', ')}
                    </p>
                  )}

                  {(plan.unmatched.length > 0 || plan.unreadable.length > 0 || plan.warnings.length > 0 || job.warnings.length > 0) && (
                    <ul className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
                      {plan.unmatched.map(name => (
                        <li key={name} className="text-xs text-amber-800">
                          {name} is not on the staff list yet — add them on the Staff page, then read this photo again to give them their shift.
                        </li>
                      ))}
                      {plan.unreadable.map(name => (
                        <li key={name} className="text-xs text-amber-800">{name} — the rostered time could not be read, so no shift was made.</li>
                      ))}
                      {[...job.warnings, ...plan.warnings].map((w, i) => <li key={i} className="text-xs text-amber-800">{w}</li>)}
                    </ul>
                  )}

                  {plan.errors.length > 0 && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-1">
                      {plan.errors.map((err, i) => <p key={i} className="text-xs text-red-700">{err}</p>)}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button onClick={() => onApply(job.id)} disabled={applying !== null || !plan.creates.length} className="btn-primary">
                      {applying === job.id ? 'Adding…' : `Add ${plan.creates.length} shift${plan.creates.length === 1 ? '' : 's'}`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-secondary">Close</button>
          {ready.length > 0 && (
            <button onClick={onApplyAll} disabled={applying !== null} className="btn-primary">
              {applying ? 'Adding…' : ready.length === 1 ? 'Add this roster' : `Add all ${ready.length} rosters`}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function StatusIcon({ status }: { status: RosterJob['status'] }) {
  if (status === 'reading') return <Loader2 size={16} className="animate-spin text-blue-600 shrink-0" />;
  if (status === 'applied') return <Check size={16} className="text-green-600 shrink-0" />;
  if (status === 'failed') return <AlertTriangle size={16} className="text-amber-500 shrink-0" />;
  if (status === 'pending') return <Loader2 size={16} className="text-slate-300 shrink-0" />;
  return <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mx-[3px]" />;
}

function summarise(plan: RosterPlan): string {
  const parts = [`${plan.creates.length} to add`];
  if (plan.duplicates.length) parts.push(`${plan.duplicates.length} already there`);
  if (plan.unmatched.length) parts.push(`${plan.unmatched.length} not on the staff list`);
  if (plan.unreadable.length) parts.push(`${plan.unreadable.length} unreadable`);
  return parts.join(' · ');
}

function shiftDate(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00`);
  moved.setDate(moved.getDate() + days);
  return moved.toISOString().split('T')[0];
}
