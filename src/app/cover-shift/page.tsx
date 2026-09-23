'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Search, Trophy, Phone, CheckCircle, XCircle, PhoneMissed,
  CalendarClock, AlertTriangle, Loader2, ArrowRight, ShieldAlert, Users, ChevronDown, Radio, Building2,
  MessageSquare, RefreshCw,
} from 'lucide-react';
import ReliabilityBar from '@/components/ReliabilityBar';
import Modal from '@/components/Modal';
import SmsModeBanner from '@/components/SmsModeBanner';
import RaceStatusPanel from '@/components/RaceStatusPanel';
import StaffName from '@/components/StaffName';
import {
  Department, CoverCandidate, Shift, SmsConfig, RacePreview, ExtendableCandidate, OverlapConflict,
} from '@/lib/types';
import {
  formatDuration, requiresBreak, BREAK_DURATION_MINUTES, formatDate, WEEKLY_HOURS_CAP_MINUTES, todayStr,
  shiftDurationMinutes, MIN_SHIFT_MINUTES, minutesUntil, MIN_COVERABLE_MINUTES,
} from '@/lib/shiftUtils';
import { formatAUMobile } from '@/lib/phone';
import { formatCost } from '@/lib/wages';
import { normalizeDeptColor } from '@/lib/deptColors';
import ErrorBanner from '@/components/ErrorBanner';
import { fetchJson } from '@/lib/apiClient';

interface CoverResult {
  shift: { id: string | null; date: string; start_time: string; end_time: string; department: Department };
  eligible_count: number;
  contactable_count: number;
  candidates: CoverCandidate[];
  extendable: ExtendableCandidate[];
  overlapExcluded: OverlapConflict[];
  backup: CoverCandidate[];
  fallback_pool: 'checkout_junior' | 'checkout_senior' | 'expanded' | null;
}

/** "543 minutes" -> "9h 3m" */
function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Short label under a blank cost figure — a data gap to fix, not a mystery. */
function costReasonLabel(reason: CoverCandidate['cost_reason']): string {
  if (reason === 'no_base_rate') return 'no base rate set';
  if (reason === 'no_birthday') return 'no birthday on file';
  if (reason === 'salary') return 'salaried';
  return 'cost';
}

function costReasonHint(reason: CoverCandidate['cost_reason']): string | undefined {
  if (reason === 'no_base_rate') return 'Set the award base rate in Settings to cost this shift.';
  if (reason === 'no_birthday') return "Add this person's date of birth on the Staff page to cost this shift.";
  if (reason === 'salary') return 'Salaried staff are paid the same regardless — no shift cost applies.';
  return undefined;
}

export default function CoverShiftPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [openShifts, setOpenShifts] = useState<Shift[]>([]);
  const [smsConfig, setSmsConfig] = useState<SmsConfig | null>(null);

  const [form, setForm] = useState({
    date: todayStr(),
    start_time: '09:00', end_time: '17:00',
    department_id: '', required_role: 'any', notes: '',
  });
  // Set when the form was filled from a real open shift. A race needs one:
  // replies arrive minutes later and must attach to something persistent.
  // When the manager searches a time instead of picking one of the open
  // shifts below, starting a race creates that shift on the fly first — for
  // when extra hands are needed and there's no existing shift to cover.
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);

  const [result, setResult] = useState<CoverResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [incidentLoading, setIncidentLoading] = useState('');
  const [extending, setExtending] = useState<string | null>(null);
  // staffId -> true once "Extend their shift" comes back pending (an
  // earlier-start ask that's gone out by SMS and hasn't been answered yet).
  const [pendingExtends, setPendingExtends] = useState<Record<string, boolean>>({});

  // How many people this shift needs covering it — usually 1, sometimes
  // more (a busy Saturday needing two checkout staff). The race keeps
  // working through every tier until this many have said yes, not just one.
  const [slotsNeeded, setSlotsNeeded] = useState(1);

  const [preview, setPreview] = useState<RacePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [raceId, setRaceId] = useState<string | null>(null);
  const [raceError, setRaceError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [deptPickerOpen, setDeptPickerOpen] = useState(false);

  const loadOpenShifts = useCallback(async () => {
    try {
      setOpenShifts(await fetchJson<Shift[]>('/api/shifts?status=open'));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load open shifts');
    }
  }, []);

  const loadPageData = useCallback(async () => {
    try {
      const data = await fetchJson<Department[]>('/api/departments');
      setDepartments(data);
      const firstSelectable = data.find(d => !d.excluded_from_claim_race);
      if (firstSelectable) setForm(f => ({ ...f, department_id: firstSelectable.id }));
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load departments');
    }
    // SMS config is best-effort: if it fails, the mode banner just stays
    // hidden rather than blocking the whole page — races still work, they
    // just won't show which SMS_MODE is active.
    fetch('/api/sms/config').then(r => r.json()).then(setSmsConfig).catch(() => {});
    loadOpenShifts();
  }, [loadOpenShifts]);

  useEffect(() => { loadPageData(); }, [loadPageData]);

  function selectShift(shift: Shift) {
    setSelectedShiftId(shift.id);
    setForm({
      date: shift.date,
      start_time: shift.start_time.slice(0, 5),
      end_time: shift.end_time.slice(0, 5),
      department_id: shift.department_id,
      required_role: shift.required_role ?? 'any',
      notes: shift.notes ?? '',
    });
    setResult(null);
    setRaceId(null);
    setRaceError('');
  }

  /** A shift stays 'open' for its whole duration, including while a claim
   *  race for it is already running — clicking one of those jumps straight
   *  to watching that race instead of letting a second one be started on
   *  top of it. */
  function viewRace(shift: Shift) {
    if (!shift.active_race_id) return;
    setSelectedShiftId(shift.id);
    setForm({
      date: shift.date,
      start_time: shift.start_time.slice(0, 5),
      end_time: shift.end_time.slice(0, 5),
      department_id: shift.department_id,
      required_role: shift.required_role ?? 'any',
      notes: shift.notes ?? '',
    });
    setResult(null);
    setRaceError('');
    setRaceId(shift.active_race_id);
  }

  /** `expand` ignores department training entirely (still respects
   *  availability, required_role, supervisor cover and the excluded sick
   *  caller) — a manual escape hatch for whenever the automatic Checkout
   *  fallback doesn't turn up anyone either, or a manager just wants to see
   *  every warm body regardless of training. */
  async function findCover(expand = false) {
    if (!form.department_id || underMinimum || notEnoughTimeLeft) return;
    // Starting a fresh search supersedes whatever was on screen before —
    // without this, a race left showing from an earlier shift hid this
    // search's own results, since they only render while raceId is unset.
    setLoading(true); setResult(null); setRaceError(''); setRaceId(null); setPreview(null);
    const res = await fetch('/api/cover-shift', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, shift_id: selectedShiftId, expand_search: expand }),
    });
    const data = await res.json();
    setLoading(false);
    // A failed request comes back as { error } — not the CoverResult shape
    // the rest of this page assumes, so it must never reach setResult.
    if (!res.ok) { setRaceError(data.error ?? 'Could not find cover for that shift.'); return; }
    setResult(data);
  }

  /**
   * Opens the confirmation dialog listing exactly who will be texted. If the
   * form was filled by searching a time rather than picking an open shift —
   * e.g. extra hands are needed and there's nothing to actually cover — the
   * shift is created on the fly first, exactly as if it had been added on
   * the Shifts page, then raced like any other open shift.
   */
  async function openRacePreview() {
    if (underMinimum || notEnoughTimeLeft) return;
    setPreviewLoading(true); setRaceError('');

    let shiftId = selectedShiftId;
    if (!shiftId) {
      const res = await fetch('/api/shifts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, notes: form.notes || null }),
      });
      const data = await res.json();
      if (!res.ok) { setPreviewLoading(false); setRaceError(data.error ?? 'Could not create that shift'); return; }
      shiftId = data.id;
      setSelectedShiftId(shiftId);
      loadOpenShifts();
    }

    const res = await fetch(`/api/claim-race?shift_id=${shiftId}&slots_needed=${slotsNeeded}`);
    const data = await res.json();
    setPreviewLoading(false);
    if (!res.ok) { setRaceError(data.error ?? 'Could not load race preview'); return; }
    setPreview(data);
  }

  async function confirmStartRace() {
    if (!selectedShiftId) return;
    setStarting(true); setRaceError('');
    const res = await fetch('/api/claim-race', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shift_id: selectedShiftId, slots_needed: slotsNeeded }),
    });
    const data = await res.json();
    setStarting(false);
    setPreview(null);
    if (!res.ok) { setRaceError(data.error ?? 'Could not start the race'); return; }
    setRaceId(data.raceId);
  }

  /** Extend someone's existing overlapping shift to cover this one instead of double-booking them.
   *  Extending later applies right away; extending earlier texts them first
   *  (see requestExtension) and comes back pending instead. */
  async function extendShift(staffId: string) {
    if (!selectedShiftId) return;
    setExtending(staffId); setRaceError('');
    const res = await fetch('/api/cover-shift/extend', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shift_id: selectedShiftId, staff_id: staffId }),
    });
    const data = await res.json();
    setExtending(null);
    if (!res.ok) { setRaceError(data.error ?? 'Could not extend the shift'); return; }
    if (data.pending) { setPendingExtends(p => ({ ...p, [staffId]: true })); return; }
    // The open shift this result was for no longer exists — back to the list.
    setResult(null);
    setSelectedShiftId(null);
    await loadOpenShifts();
  }

  /** "Check now" on a pending extend ask. If the open shift is gone, someone
   *  already confirmed it (or it was resolved another way) — back to the
   *  list, same as an instant extension. Otherwise just refresh the search
   *  so a decline/expiry shows up. */
  async function recheckExtend() {
    if (!selectedShiftId) { await findCover(); return; }
    const stillOpen = await fetchJson<Shift[]>('/api/shifts?status=open');
    setOpenShifts(stillOpen);
    if (!stillOpen.some(s => s.id === selectedShiftId)) {
      setPendingExtends({});
      setResult(null);
      setSelectedShiftId(null);
      return;
    }
    // Still open — either still pending or they said no. Either way, drop
    // the local "waiting" flag rather than let it go stale forever: a
    // declined ask is free to try again, and re-clicking a genuinely still-
    // pending one just gets the "already asked" message back.
    setPendingExtends({});
    await findCover();
  }

  async function logIncident(staffId: string, type: 'no_show' | 'no_answer' | 'rejected' | 'covered') {
    setIncidentLoading(staffId + type);
    await fetch('/api/reliability', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staff_id: staffId, incident_type: type, date: form.date }),
    });
    setIncidentLoading('');
    findCover();
  }

  const needsBreak = requiresBreak(form.start_time, form.end_time);
  const underMinimum = shiftDurationMinutes(form.start_time, form.end_time) < MIN_SHIFT_MINUTES;
  // Judged by time left until the shift ENDS, not its start — a no-show
  // shift is exactly the case where the start time has already passed and
  // it's still worth covering, so this only blocks once there's under 3
  // hours left either way. Both sides read from the browser's own clock,
  // same as a manager searching "today" late in the evening is comparing
  // against their own "now", not a server's.
  const notEnoughTimeLeft = minutesUntil(form.date, form.end_time, todayStr(), new Date().toTimeString().slice(0, 5)) < MIN_COVERABLE_MINUTES;
  const deptName = (id: string) => departments.find(d => d.id === id)?.name ?? '';
  const selectableDepartments = departments.filter(d => !d.excluded_from_claim_race);
  const selectedDept = departments.find(d => d.id === form.department_id) ?? null;

  function pickDepartment(id: string) {
    setForm(f => ({ ...f, department_id: id }));
    setSelectedShiftId(null);
    setDeptPickerOpen(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Find Cover</h1>
        <p className="text-sm text-slate-500">
          Pick an open shift, or search a time to bring in extra hands, then start a claim race
        </p>
      </div>

      <SmsModeBanner config={smsConfig} />

      {loadError && <ErrorBanner message={loadError} onRetry={loadPageData} />}

      {/* Open shifts — the entry point for a race */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <CalendarClock size={16} className="text-slate-400" />
          <h2 className="font-semibold text-slate-800">Open Shifts</h2>
          <span className="badge-slate">{openShifts.length}</span>
        </div>

        {openShifts.length === 0 ? (
          <p className="text-sm text-slate-400 py-2">
            No open shifts. Create one on the Shifts page to run a claim race.
          </p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {openShifts.map(s => {
              const racing = !!s.active_race_id;
              return (
                <button
                  key={s.id}
                  onClick={() => racing ? viewRace(s) : selectShift(s)}
                  title={racing ? 'A claim race is already running for this shift — click to watch it' : undefined}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    racing
                      ? 'border-amber-300 bg-amber-50 hover:bg-amber-100'
                      : selectedShiftId === s.id
                        ? 'border-blue-400 bg-blue-50'
                        : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <p className="font-medium text-sm text-slate-800 flex items-center gap-1.5">
                    {formatDate(s.date)} · {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                    {racing && (
                      <span className="badge-amber text-[10px]">
                        <Radio size={10} className="mr-1" /> Race in progress
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {s.departments?.name ?? deptName(s.department_id)}
                    {s.required_role && s.required_role !== 'any' && ` · ${s.required_role}`}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Search form — also how to bring in extra hands with no existing
          shift to cover: fill this in instead of picking one above, and
          starting a race creates it on the fly. */}
      <div className="card p-5">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 items-end">
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={form.date}
              onChange={e => { setForm(f => ({ ...f, date: e.target.value })); setSelectedShiftId(null); }} />
          </div>
          <div>
            <label className="label">Start Time</label>
            <input type="time" className="input" value={form.start_time}
              onChange={e => { setForm(f => ({ ...f, start_time: e.target.value })); setSelectedShiftId(null); }} />
          </div>
          <div>
            <label className="label">End Time</label>
            <input type="time" className="input" value={form.end_time}
              onChange={e => { setForm(f => ({ ...f, end_time: e.target.value })); setSelectedShiftId(null); }} />
          </div>
          <div>
            <label className="label">Department</label>
            <button
              type="button"
              onClick={() => setDeptPickerOpen(true)}
              className="input flex items-center justify-between text-left"
            >
              {selectedDept ? (
                <span className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: normalizeDeptColor(selectedDept.color) }} />
                  <span className="truncate">{selectedDept.name}</span>
                </span>
              ) : (
                <span className="text-slate-400">Select department...</span>
              )}
              <ChevronDown size={14} className="text-slate-400 shrink-0" />
            </button>
          </div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.required_role}
              onChange={e => { setForm(f => ({ ...f, required_role: e.target.value })); setSelectedShiftId(null); }}>
              <option value="any">Any</option>
              <option value="senior">Senior</option>
              <option value="junior">Junior</option>
            </select>
          </div>
        </div>

        {!selectedShiftId && (
          <div className="mt-3">
            <label className="label">Notes (optional)</label>
            <input className="input" value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="e.g. Extra hands for the Friday rush" />
          </div>
        )}

        <div className="flex items-center gap-4 mt-4 flex-wrap">
          <div>
            <label className="label">How many staff?</label>
            <select className="input" value={slotsNeeded}
              onChange={e => setSlotsNeeded(Number(e.target.value))}>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </div>
          <button onClick={() => findCover()} disabled={loading || !form.department_id || underMinimum || notEnoughTimeLeft} className="btn-primary">
            <Search size={16} /> {loading ? 'Searching...' : 'Find Available Staff'}
          </button>
          <p className={`text-sm ${underMinimum ? 'text-red-600' : 'text-slate-500'}`}>
            Duration: <strong>{formatDuration(form.start_time, form.end_time)}</strong>
            {underMinimum
              ? <span className="ml-2">— shifts must be at least {MIN_SHIFT_MINUTES / 60}h</span>
              : needsBreak && <span className="ml-2 text-amber-600">+ {BREAK_DURATION_MINUTES}m break</span>}
          </p>
        </div>

        {notEnoughTimeLeft && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-start gap-2">
            <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /> Less than {MIN_COVERABLE_MINUTES / 60} hours remain until this shift ends — try a different time.
          </div>
        )}
      </div>

      {raceError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-start gap-2">
          <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /> {raceError}
        </div>
      )}

      {/* Live race */}
      {raceId && (
        <RaceStatusPanel
          raceId={raceId}
          config={smsConfig}
          onFinished={() => { loadOpenShifts(); findCover(); }}
        />
      )}

      {/* Results */}
      {result && !raceId && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-slate-700">
              Found <strong>{result.eligible_count} eligible staff</strong> for{' '}
              {result.shift.department?.name} · {result.shift.start_time}–{result.shift.end_time}
              {result.contactable_count !== undefined &&
                result.contactable_count < result.eligible_count && (
                  <span className="text-amber-600">
                    {' '}({result.contactable_count} contactable by SMS)
                  </span>
                )}
            </p>
            <div className="flex items-center gap-3">
              {result.fallback_pool !== 'expanded' && (
                <button
                  onClick={() => findCover(true)}
                  disabled={loading}
                  title="Ignore department training entirely and show every available staff member — a manual override for whenever the automatic Checkout fallback still doesn't turn up anyone"
                  className="btn-secondary text-sm"
                >
                  <Users size={14} /> Expand Search
                </button>
              )}
              {result.candidates.length > 0 && (
                <>
                  {!selectedShiftId && (
                    <span className="text-xs text-slate-400 max-w-xs text-right">
                      No open shift selected — starting a race will create one for this time
                    </span>
                  )}
                  <button
                    onClick={openRacePreview}
                    disabled={previewLoading}
                    className="btn-primary"
                    title={selectedShiftId ? undefined : 'Creates a new open shift for this time, then starts the race'}
                  >
                    {previewLoading
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Phone size={14} />} Start Claim Race
                  </button>
                </>
              )}
            </div>
          </div>

          {result.fallback_pool && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
              <ShieldAlert size={15} className="flex-shrink-0 mt-0.5" />
              {result.fallback_pool === 'expanded'
                ? <>Expanded search — showing every available staff member regardless of department training.</>
                : <>
                    No one trained in {result.shift.department?.name} was eligible and available, so this list is
                    Checkout staff instead{result.fallback_pool === 'checkout_junior' ? ' (juniors)' : ' — including seniors, since no juniors were available either'}.
                  </>}
            </div>
          )}

          {/* Already rostered overlapping this time, but extending covers it
              within 10h — shown first so it's never missed below a long
              ranked list further down the page. */}
          {result.extendable.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <ArrowRight size={14} className="text-blue-500" />
                <h3 className="text-sm font-semibold text-slate-700">
                  Extend an existing shift instead ({result.extendable.length})
                </h3>
              </div>
              <p className="text-xs text-slate-500">
                Already rostered overlapping this time — excluded from the claim race, but stretching their shift covers it without double-booking them.
              </p>
              {result.extendable.map(c => (
                <div key={c.id} className="card p-3 sm:p-4 flex flex-wrap items-center gap-3 sm:gap-4 border-blue-200 bg-blue-50/40">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StaffName staffId={c.id} name={c.name} className="font-semibold text-slate-800" />
                      {c.existing_shift.department_name && (
                        <span className="badge-slate inline-flex items-center gap-1 text-[11px]">
                          <Building2 size={10} /> Currently on {c.existing_shift.department_name}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 font-mono">
                      {c.existing_shift.start_time.slice(0, 5)}–{c.existing_shift.end_time.slice(0, 5)}
                      <span className="mx-1.5 text-slate-400">→</span>
                      <span className="text-blue-700">{c.proposed.start_time.slice(0, 5)}–{c.proposed.end_time.slice(0, 5)}</span>
                      <span className="ml-1.5 text-slate-400">({formatDuration(c.proposed.start_time, c.proposed.end_time)})</span>
                    </p>
                    {c.proposed.start_time < c.existing_shift.start_time && !pendingExtends[c.id] && (
                      <p className="text-xs text-slate-400 mt-0.5">
                        Starts earlier than they're rostered — they're not at the store yet, so this texts them to confirm first.
                      </p>
                    )}
                  </div>
                  {pendingExtends[c.id] ? (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="badge-blue inline-flex items-center gap-1">
                        <MessageSquare size={11} /> Texted — waiting for reply
                      </span>
                      <button onClick={() => recheckExtend()} className="btn-ghost text-xs px-2 py-1" title="Re-check">
                        <RefreshCw size={12} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => extendShift(c.id)}
                      disabled={extending !== null}
                      className="btn-primary flex-shrink-0"
                    >
                      {extending === c.id ? <Loader2 size={14} className="animate-spin" /> : 'Extend their shift'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {result.candidates.length === 0 && result.extendable.length === 0 &&
           result.overlapExcluded.length === 0 && result.backup.length === 0 ? (
            <div className="card p-8 text-center text-slate-400">
              <p className="font-medium">No eligible staff found</p>
              <p className="text-sm mt-1">Try a different time range or check staff availability templates.</p>
            </div>
          ) : result.candidates.length === 0 ? null : (
            <div className="space-y-2">
              {/* Rank + name hold the first line; cost, score and the incident
                  buttons drop to a second full-width line on a phone rather
                  than crushing the name into an ellipsis. */}
              {result.candidates.map((c, i) => (
                <div key={c.id} className={`card p-3 sm:p-4 flex flex-wrap items-center gap-3 sm:gap-4 ${i === 0 ? 'border-blue-300 bg-blue-50/50' : ''}`}>
                  <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold bg-slate-100 text-slate-600">
                    {i === 0 ? <Trophy size={16} className="text-amber-500" /> : i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StaffName staffId={c.id} name={c.name} className="font-semibold text-slate-800" />
                      <span className={c.age_group === 'senior' ? 'badge-blue' : 'badge-amber'}>
                        {c.age_group === 'senior' ? 'Senior' : 'Junior'}
                      </span>
                      <span className="badge-slate capitalize">{c.role_type.replace(/_/g, ' ')}</span>
                      {!c.phone_e164 && <span className="badge-red">No mobile</span>}
                      {c.sms_opt_out && <span className="badge-red">Opted out</span>}
                      {c.recently_absent && (
                        <span className="badge-amber" title="Called in sick or no-showed in the last 3 days — still offered, ranked near the bottom">
                          Recently absent
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 w-full max-w-[12rem]">
                      <ReliabilityBar score={c.reliability_score} />
                    </div>
                  </div>
                  <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-semibold text-slate-700">
                        {c.shift_cost === null
                          ? <span className="text-slate-300 font-normal" title={costReasonHint(c.cost_reason)}>no rate</span>
                          : formatCost(c.shift_cost)}
                      </p>
                      <p className="text-xs text-slate-400">
                        {c.shift_cost === null ? costReasonLabel(c.cost_reason) : 'cost'}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-lg font-bold text-slate-700">{c.computed_score}</p>
                      <p className="text-xs text-slate-400">score</p>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button title="Covered" disabled={!!incidentLoading}
                        onClick={() => logIncident(c.id, 'covered')}
                        className="btn-ghost p-1.5 text-green-600 hover:bg-green-50"
                      ><CheckCircle size={16} /></button>
                      <button title="Rejected" disabled={!!incidentLoading}
                        onClick={() => logIncident(c.id, 'rejected')}
                        className="btn-ghost p-1.5 text-orange-500 hover:bg-orange-50"
                      ><XCircle size={16} /></button>
                      <button title="No answer" disabled={!!incidentLoading}
                        onClick={() => logIncident(c.id, 'no_answer')}
                        className="btn-ghost p-1.5 text-slate-500 hover:bg-slate-100"
                      ><PhoneMissed size={16} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Overlapping, but stretching it would run past the 10h cap — no action offered */}
          {result.overlapExcluded.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <p className="font-medium text-slate-600 mb-1">
                {result.overlapExcluded.length} already rostered overlapping this time — can't extend without exceeding 10 hours
              </p>
              <ul className="text-slate-500 text-xs space-y-0.5">
                {result.overlapExcluded.map(c => (
                  <li key={c.id}><StaffName staffId={c.id} name={c.name} /> — {c.existing_shift.start_time.slice(0, 5)}–{c.existing_shift.end_time.slice(0, 5)}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Would exceed the weekly hours cap — kept as a manual backup, not raced */}
          {result.backup.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <ShieldAlert size={14} className="text-amber-500" />
                <h3 className="text-sm font-semibold text-slate-700">
                  Backup — would exceed {WEEKLY_HOURS_CAP_MINUTES / 60}h this week ({result.backup.length})
                </h3>
              </div>
              <p className="text-xs text-slate-500">
                Excluded from the claim race for going over the weekly hours cap. Kept here in case there's no other option — contact them yourself if you decide to.
              </p>
              {result.backup.map(c => (
                <div key={c.id} className="card p-3 sm:p-4 flex flex-wrap items-center gap-3 sm:gap-4 border-amber-200 bg-amber-50/40">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StaffName staffId={c.id} name={c.name} className="font-semibold text-slate-800" />
                      <span className={c.age_group === 'senior' ? 'badge-blue' : 'badge-amber'}>
                        {c.age_group === 'senior' ? 'Senior' : 'Junior'}
                      </span>
                    </div>
                    <p className="text-xs text-amber-700 mt-1">
                      {formatMinutes(c.weekly_minutes_before)} already this week — this shift would bring it to{' '}
                      <strong>{formatMinutes(c.weekly_minutes_after)}</strong>
                    </p>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button title="Covered" disabled={!!incidentLoading}
                      onClick={() => logIncident(c.id, 'covered')}
                      className="btn-ghost p-1.5 text-green-600 hover:bg-green-50"
                    ><CheckCircle size={16} /></button>
                    <button title="Rejected" disabled={!!incidentLoading}
                      onClick={() => logIncident(c.id, 'rejected')}
                      className="btn-ghost p-1.5 text-orange-500 hover:bg-orange-50"
                    ><XCircle size={16} /></button>
                    <button title="No answer" disabled={!!incidentLoading}
                      onClick={() => logIncident(c.id, 'no_answer')}
                      className="btn-ghost p-1.5 text-slate-500 hover:bg-slate-100"
                    ><PhoneMissed size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Confirmation — every number about to be texted, shown before sending */}
      {preview && (
        <Modal title="Start claim race?" onClose={() => setPreview(null)} size="lg">
          <div className="space-y-4">
            <SmsModeBanner config={smsConfig} />

            <div>
              <p className="text-sm text-slate-600">
                <strong>{preview.contactable.length}</strong> staff will be texted about{' '}
                <strong>
                  {formatDate(preview.shift.date)} {preview.shift.start_time.slice(0, 5)}–
                  {preview.shift.end_time.slice(0, 5)}
                </strong>{' '}
                ({preview.shift.departments?.name}).{' '}
                {preview.slots_needed > 1
                  ? <>The first <strong>{preview.slots_needed}</strong> to reply YES get the shift;
                      everyone else is told it has been covered.</>
                  : <>The first to reply YES gets the shift; everyone else is told it has been covered.</>}
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-56 overflow-y-auto">
              {preview.contactable.map(c => (
                <div key={c.id} className="px-3 py-2 flex items-center justify-between text-sm">
                  <StaffName staffId={c.id} name={c.name} className="text-slate-800" />
                  <span className="text-slate-400 font-mono text-xs">
                    {smsConfig?.mode === 'redirect'
                      ? `→ ${smsConfig.test_number}`
                      : formatAUMobile(c.phone_e164)}
                  </span>
                </div>
              ))}
            </div>

            {preview.excluded.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm">
                <p className="font-medium text-amber-900 mb-1">
                  {preview.excluded.length} eligible staff cannot be texted
                </p>
                <ul className="text-amber-800 text-xs space-y-0.5">
                  {preview.excluded.map(e => (
                    <li key={e.staffId}>
                      {e.name} — {e.reason === 'no_phone' ? 'no valid mobile number' : 'opted out of SMS'}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(preview.extendable.length > 0 || preview.backup.length > 0) && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
                <p className="font-medium text-slate-600 mb-1">Not included in this race</p>
                <ul className="text-slate-500 text-xs space-y-0.5">
                  {preview.extendable.map(e => (
                    <li key={e.id}>
                      {e.name} — already rostered{e.existing_shift.department_name ? ` on ${e.existing_shift.department_name}` : ''} overlapping this time (extendable instead — close this and use the option below)
                    </li>
                  ))}
                  {preview.backup.map(b => (
                    <li key={b.id}>{b.name} — would exceed 38h this week (kept as a backup option below)</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setPreview(null)} className="btn-secondary">Cancel</button>
              <button onClick={confirmStartRace} disabled={starting || preview.contactable.length === 0}
                className="btn-primary">
                {starting
                  ? <><Loader2 size={14} className="animate-spin" /> Starting…</>
                  : <><Phone size={14} /> Text {preview.contactable.length} staff</>}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {deptPickerOpen && (
        <Modal title="Select Department" onClose={() => setDeptPickerOpen(false)}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {selectableDepartments.map(d => (
              <button
                key={d.id}
                onClick={() => pickDepartment(d.id)}
                className={`text-left p-3 rounded-lg border transition-colors flex items-center gap-2 ${
                  form.department_id === d.id
                    ? 'border-blue-400 bg-blue-50'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: normalizeDeptColor(d.color) }} />
                <span className="flex-1 min-w-0">
                  <span className="font-medium text-sm text-slate-800 truncate block">{d.name}</span>
                  {d.requires_supervisor && <span className="text-xs text-amber-600">Supervisor required</span>}
                </span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
