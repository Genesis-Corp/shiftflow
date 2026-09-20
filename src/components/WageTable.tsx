'use client';

import { useCallback, useEffect, useState } from 'react';
import { Camera, FileText, FileSpreadsheet, Table2, Loader2, Trash2, Plus, AlertTriangle, DollarSign, CalendarDays, Clock, Sparkles, Globe, Moon } from 'lucide-react';
import Modal from '@/components/Modal';
import UploadMenu from '@/components/UploadMenu';
import DropOverlay from '@/components/DropOverlay';
import { useFileDrop } from '@/lib/useFileDrop';
import ProgressBar, { ProgressStage } from '@/components/ProgressBar';
import { STAGES } from '@/lib/progressStages';
import { downscalePhoto } from '@/lib/image';
import { readPdfAsBase64 } from '@/lib/pdf';
import { postJson } from '@/lib/api';
import { fetchJson } from '@/lib/apiClient';
import { DAY_SHORT, formatDate } from '@/lib/shiftUtils';
import Papa from 'papaparse';
import type { AgeBracket, TimeLoading, EmploymentCategory, OvertimeTier, OvertimeOverride } from '@/lib/wages';
import type { SchoolHoliday } from '@/lib/types';

interface BaseRate {
  id: string;
  adult_hourly_rate: number;
  updated_at: string;
}

interface PublicHoliday {
  date: string;
  name: string;
}

interface WagesData {
  base_rate: BaseRate | null;
  age_brackets: AgeBracket[];
  time_loadings: TimeLoading[];
  public_holidays: PublicHoliday[];
  overtime_tiers: OvertimeTier[];
  overtime_overrides: OvertimeOverride[];
}

interface StoreSettings {
  id: string;
  country: string | null;
  state: string | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

interface ScanResult {
  rate: number;
  current_rate: number | null;
}

/** School holiday ranges read off an uploaded term dates page, pending review. */
interface ScannedTerms {
  region: string;
  terms_read: number;
  holidays: { start_date: string; end_date: string; name: string }[];
}

const EMPTY_HOLIDAY = { date: '', name: '' };
const EMPTY_SCHOOL_HOLIDAY = { start_date: '', end_date: '', name: '' };

const CATEGORY_LABELS: Record<string, string> = {
  sunday: 'Sunday Rates',
  saturday: 'Saturday Rates',
  evening: 'Evening Rates',
  before_open: 'Before-Open Rates',
  public_holiday: 'Public Holiday Rates',
  weekday: 'Weekday Rates',
};

function categoryLabel(group: string): string {
  return CATEGORY_LABELS[group] ?? group.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

/**
 * The award wage structure Farmer Jack's staff are paid against: one base
 * rate, the age and time-of-week percentages it's multiplied by, and the
 * public holiday calendar.
 *
 * Nobody's individual pay is stored here — it's computed for each staff
 * member from their birthday, employment type and (for the 20-21 bracket)
 * commencement date, against this structure. That's what decides who a
 * manager calls in, so a scanned base rate is always previewed before it's
 * applied.
 */
export default function WageTable() {
  const [data, setData] = useState<WagesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [stage, setStage] = useState<ProgressStage | null>(null);
  const [scanned, setScanned] = useState<ScanResult | null>(null);
  const [applying, setApplying] = useState(false);

  const [holidayTab, setHolidayTab] = useState<'public' | 'school'>('public');
  const [newHoliday, setNewHoliday] = useState(EMPTY_HOLIDAY);
  const [addingHoliday, setAddingHoliday] = useState(false);

  const [schoolHolidays, setSchoolHolidays] = useState<SchoolHoliday[]>([]);
  const [newSchoolHoliday, setNewSchoolHoliday] = useState(EMPTY_SCHOOL_HOLIDAY);
  const [addingSchoolHoliday, setAddingSchoolHoliday] = useState(false);
  const [generatingSchool, setGeneratingSchool] = useState(false);
  const [scannedTerms, setScannedTerms] = useState<ScannedTerms | null>(null);
  const [applyingTerms, setApplyingTerms] = useState(false);

  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [countryInput, setCountryInput] = useState('');
  const [stateInput, setStateInput] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [quietStartInput, setQuietStartInput] = useState('');
  const [quietEndInput, setQuietEndInput] = useState('');
  const [savingQuietHours, setSavingQuietHours] = useState(false);
  const [quietHoursError, setQuietHoursError] = useState('');

  const [newTier, setNewTier] = useState<Record<EmploymentCategory, { hours: string; pct: string }>>({
    ft_pt: { hours: '', pct: '' },
    casual: { hours: '', pct: '' },
  });
  const [addingTier, setAddingTier] = useState<EmploymentCategory | null>(null);
  const [newOverrideGroup, setNewOverrideGroup] = useState('');
  const [savingOverride, setSavingOverride] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await fetchJson<WagesData>('/api/wages');
      setData(result);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load wages');
    }
    setLoading(false);
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const result = await fetchJson<StoreSettings>('/api/settings/store');
      setSettings(result);
      setCountryInput(result.country ?? '');
      setStateInput(result.state ?? '');
      setQuietStartInput(result.quiet_hours_start?.slice(0, 5) ?? '');
      setQuietEndInput(result.quiet_hours_end?.slice(0, 5) ?? '');
    } catch {
      // Store settings aren't essential to the rest of the page — leave the inputs blank rather than blocking.
    }
  }, []);

  const loadSchoolHolidays = useCallback(async () => {
    try {
      setSchoolHolidays(await fetchJson<SchoolHoliday[]>('/api/school-holidays'));
    } catch {
      // Not essential to the rest of the page — leave the list empty rather than blocking.
    }
  }, []);

  useEffect(() => { load(); loadSettings(); loadSchoolHolidays(); }, [load, loadSettings, loadSchoolHolidays]);

  function pickFile(file: File) {
    const name = file.name.toLowerCase();
    if (file.type === 'text/csv' || name.endsWith('.csv')) {
      void readCsvSheet(file);
    } else {
      void readSheet(file);
    }
  }

  async function readCsvSheet(file: File) {
    setError('');
    setStage(STAGES.parsing);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (result) => {
        const scan = await postJson<ScanResult>('/api/scan-wages', { csv: result.data }, { timeoutMs: 30_000 });
        setStage(null);
        if (!scan.ok || !scan.data) { setError(scan.error ?? 'Could not read that CSV.'); return; }
        setScanned(scan.data);
      },
      error: (err: Error) => {
        setStage(null);
        setError(`"${file.name}" could not be read: ${err.message}`);
      },
    });
  }

  async function readSheet(file: File) {
    setError('');
    const kind: 'image' | 'pdf' = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image';
    try {
      let scan;
      if (kind === 'pdf') {
        setStage(STAGES.preparingPdf);
        const pdf = await readPdfAsBase64(file);
        setStage(STAGES.readingPdf);
        scan = await postJson<ScanResult>('/api/scan-wages', { pdf }, { timeoutMs: 70_000 });
      } else {
        setStage(STAGES.preparing);
        const { base64, mediaType } = await downscalePhoto(file);
        setStage(STAGES.reading);
        scan = await postJson<ScanResult>('/api/scan-wages', { image: base64, mediaType }, { timeoutMs: 70_000 });
      }
      if (!scan.ok || !scan.data) { setError(scan.error ?? 'Could not read that wage table.'); return; }
      setScanned(scan.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that wage table.');
    } finally {
      setStage(null);
    }
  }

  async function applyScanned() {
    if (!scanned) return;
    setApplying(true);
    const res = await fetch('/api/wages', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adult_hourly_rate: scanned.rate }),
    });
    setApplying(false);
    setScanned(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Could not save that rate.');
      return;
    }
    load();
  }

  async function addHoliday(e: React.FormEvent) {
    e.preventDefault();
    setAddingHoliday(true);
    const res = await postJson('/api/wages/holidays', newHoliday);
    setAddingHoliday(false);
    if (!res.ok) { setError(res.error ?? 'Could not add that holiday'); return; }
    setNewHoliday(EMPTY_HOLIDAY);
    load();
  }

  async function removeHoliday(date: string) {
    await fetch(`/api/wages/holidays?date=${date}`, { method: 'DELETE' });
    load();
  }

  async function addSchoolHoliday(e: React.FormEvent) {
    e.preventDefault();
    setAddingSchoolHoliday(true);
    const res = await postJson('/api/school-holidays', newSchoolHoliday);
    setAddingSchoolHoliday(false);
    if (!res.ok) { setError(res.error ?? 'Could not add that school holiday'); return; }
    setNewSchoolHoliday(EMPTY_SCHOOL_HOLIDAY);
    loadSchoolHolidays();
  }

  async function removeSchoolHoliday(id: string) {
    await fetch(`/api/school-holidays?id=${id}`, { method: 'DELETE' });
    loadSchoolHolidays();
  }

  /** Fill the school calendar from the store's country/state, where school
   *  terms are published for it. Far fewer locations than public holidays. */
  async function generateSchoolHolidays() {
    setGeneratingSchool(true);
    setError('');
    const res = await fetch('/api/school-holidays/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: new Date().getFullYear() }),
    });
    setGeneratingSchool(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setError(d.error ?? 'Could not read school holidays for this location.'); return; }
    loadSchoolHolidays();
  }

  /** Read a screenshot or PDF of an education department's term dates page.
   *  Nothing is saved until the manager checks the read against the page. */
  async function pickSchoolFile(file: File) {
    setError('');
    const name = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
    const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/.test(name);

    if (!isPdf && !isImage) {
      setError(`"${file.name}" isn't a photo or PDF. Screenshot your education department's term dates page, or save it as a PDF.`);
      return;
    }

    try {
      let scan;
      if (isPdf) {
        setStage(STAGES.preparingPdf);
        const pdf = await readPdfAsBase64(file);
        setStage(STAGES.readingPdf);
        scan = await postJson<ScannedTerms>('/api/scan-school-terms', { pdf }, { timeoutMs: 70_000 });
      } else {
        setStage(STAGES.preparing);
        const { base64, mediaType } = await downscalePhoto(file);
        setStage(STAGES.reading);
        scan = await postJson<ScannedTerms>('/api/scan-school-terms', { image: base64, mediaType }, { timeoutMs: 70_000 });
      }
      if (!scan.ok || !scan.data) { setError(scan.error ?? 'Could not read those term dates.'); return; }
      setScannedTerms(scan.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read those term dates.');
    } finally {
      setStage(null);
    }
  }

  async function applyScannedTerms() {
    if (!scannedTerms) return;
    setApplyingTerms(true);
    const res = await postJson('/api/school-holidays', { holidays: scannedTerms.holidays });
    setApplyingTerms(false);
    setScannedTerms(null);
    if (!res.ok) { setError(res.error ?? 'Could not save those school holidays.'); return; }
    loadSchoolHolidays();
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!countryInput.trim()) return;
    setSavingSettings(true);
    const res = await fetch('/api/settings/store', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: countryInput.trim(), state: stateInput.trim() || null }),
    });
    setSavingSettings(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? 'Could not save store settings.'); return; }
    loadSettings();
  }

  async function saveQuietHours(e: React.FormEvent) {
    e.preventDefault();
    const start = quietStartInput.trim();
    const end = quietEndInput.trim();
    if ((start && !end) || (!start && end)) {
      setQuietHoursError('Set both a start and end time, or clear both to turn quiet hours off.');
      return;
    }
    setQuietHoursError('');
    setSavingQuietHours(true);
    const res = await fetch('/api/settings/store', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quiet_hours_start: start || null, quiet_hours_end: end || null }),
    });
    setSavingQuietHours(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setQuietHoursError(d.error ?? 'Could not save quiet hours.'); return; }
    loadSettings();
  }

  async function generateHolidays() {
    setGenerating(true);
    setError('');
    const res = await fetch('/api/wages/holidays/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: new Date().getFullYear() }),
    });
    setGenerating(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setError(d.error ?? 'Could not generate public holidays.'); return; }
    load();
  }

  async function addTier(category: EmploymentCategory, e: React.FormEvent) {
    e.preventDefault();
    const { hours, pct } = newTier[category];
    setAddingTier(category);
    const res = await postJson('/api/wages/overtime-tiers', {
      employment_category: category,
      hours_into_overtime: Number(hours),
      percentage: Number(pct),
    });
    setAddingTier(null);
    if (!res.ok) { setError(res.error ?? 'Could not add that overtime tier.'); return; }
    setNewTier(t => ({ ...t, [category]: { hours: '', pct: '' } }));
    load();
  }

  async function removeTier(id: string) {
    await fetch(`/api/wages/overtime-tiers?id=${id}`, { method: 'DELETE' });
    load();
  }

  async function toggleOverride(o: OvertimeOverride) {
    setSavingOverride(o.category_group);
    await postJson('/api/wages/overtime-overrides', {
      category_group: o.category_group,
      label: categoryLabel(o.category_group),
      overridable: !o.overridable,
    });
    setSavingOverride('');
    load();
  }

  async function addOverride(e: React.FormEvent) {
    e.preventDefault();
    if (!newOverrideGroup) return;
    setSavingOverride(newOverrideGroup);
    await postJson('/api/wages/overtime-overrides', {
      category_group: newOverrideGroup,
      label: categoryLabel(newOverrideGroup),
      overridable: false,
    });
    setSavingOverride('');
    setNewOverrideGroup('');
    load();
  }

  async function removeOverride(group: string) {
    await fetch(`/api/wages/overtime-overrides?category_group=${group}`, { method: 'DELETE' });
    load();
  }

  // One drop target for the page, pointed at whichever holiday tab is open —
  // the overlay says which, so a dropped file never gets read as the wrong
  // kind of document without warning.
  const droppingSchoolTerms = holidayTab === 'school';
  const { dragging, dropHandlers } = useFileDrop(files => {
    for (const file of files) {
      if (droppingSchoolTerms) void pickSchoolFile(file);
      else pickFile(file);
    }
  }, stage !== null);

  const ftPtLoadings = (data?.time_loadings ?? []).filter(l => l.employment_category === 'ft_pt');
  const casualLoadings = (data?.time_loadings ?? []).filter(l => l.employment_category === 'casual');

  function loadingLabel(l: TimeLoading): string {
    if (l.is_public_holiday) return 'Public holiday';
    const days = l.days.length === 6 ? 'Mon-Sat' : l.days.map(d => DAY_SHORT[d]).join(', ');
    return `${l.label} — ${days} ${l.start_time.slice(0, 5)}–${l.end_time.slice(0, 5)}`;
  }

  const tiersFor = (category: EmploymentCategory) =>
    (data?.overtime_tiers ?? [])
      .filter(t => t.employment_category === category)
      .sort((a, b) => a.hours_into_overtime - b.hours_into_overtime);

  const overrides = data?.overtime_overrides ?? [];
  const knownGroups = Array.from(new Set((data?.time_loadings ?? []).map(l => l.category_group)));
  const addableGroups = knownGroups.filter(g => !overrides.some(o => o.category_group === g));

  return (
    <div className="space-y-6" {...dropHandlers}>
      <DropOverlay
        active={dragging}
        label={droppingSchoolTerms
          ? 'Drop a screenshot or PDF of your education department’s term dates'
          : 'Drop the wage table photo, PDF or CSV to read its base rate'}
      />
      {stage && <ProgressBar stage={stage} />}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-start gap-2">
          <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {/* ── Award base rate ──────────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div>
            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
              <DollarSign size={16} className="text-slate-400" /> Award Base Rate
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              The adult ordinary Mon-Fri rate — everyone&apos;s pay is computed from this, their age and their
              employment type. There&apos;s no separate rate to set per person.
            </p>
          </div>
          <UploadMenu
            disabled={stage !== null}
            options={[
              {
                key: 'capture', label: 'Capture', icon: <Camera size={14} />, accept: 'image/*', capture: 'environment',
                onChange: e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) pickFile(file); },
              },
              {
                key: 'upload', label: 'Upload', icon: <FileText size={14} />, accept: 'image/*',
                onChange: e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) pickFile(file); },
              },
              {
                key: 'pdf', label: 'Upload PDF', icon: <FileSpreadsheet size={14} />, accept: 'application/pdf',
                onChange: e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) pickFile(file); },
              },
              {
                key: 'csv', label: 'Upload CSV', icon: <Table2 size={14} />, accept: '.csv,text/csv',
                onChange: e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) pickFile(file); },
              },
            ]}
          />
        </div>

        {loading ? <p className="text-slate-400 text-sm">Loading…</p> : (
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-800">
              {data?.base_rate ? `$${Number(data.base_rate.adult_hourly_rate).toFixed(2)}` : '—'}
            </span>
            <span className="text-sm text-slate-400">/hr</span>
            {data?.base_rate && (
              <span className="text-xs text-slate-400 ml-2">
                effective from {formatDate(data.base_rate.updated_at.slice(0, 10))}
              </span>
            )}
          </div>
        )}
        {!loading && !data?.base_rate && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
            No base rate set yet — nobody&apos;s shift cost can be computed until one is uploaded or entered.
          </p>
        )}
      </div>

      {/* ── Age brackets & time loadings ─────────────────────────────────── */}
      <div className="card p-5">
        <h2 className="font-semibold text-slate-800 mb-1">Award structure</h2>
        <p className="text-xs text-slate-500 mb-3">
          The age and time-of-week percentages every rate is computed from. Fixed by the enterprise agreement — get
          in touch if these ever need to change.
        </p>

        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Age brackets</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          {(data?.age_brackets ?? []).map(b => (
            <div key={b.id} className="rounded-lg border border-slate-200 px-3 py-2">
              <p className="text-xs text-slate-500 truncate">{b.label}</p>
              <p className="text-sm font-semibold text-slate-800">{b.percentage}%</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Full &amp; part-time</p>
            <ul className="divide-y divide-slate-100 text-xs">
              {ftPtLoadings.map(l => (
                <li key={l.id} className="py-1.5 flex items-center justify-between gap-2">
                  <span className="text-slate-600">{loadingLabel(l)}</span>
                  <span className="badge-slate font-mono shrink-0">{l.percentage}%</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Casual</p>
            <ul className="divide-y divide-slate-100 text-xs">
              {casualLoadings.map(l => (
                <li key={l.id} className="py-1.5 flex items-center justify-between gap-2">
                  <span className="text-slate-600">{loadingLabel(l)}</span>
                  <span className="badge-slate font-mono shrink-0">{l.percentage}%</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* ── Overtime settings ───────────────────────────────────────────── */}
      <div className="card p-5">
        <h2 className="font-semibold text-slate-800 flex items-center gap-2 mb-1">
          <Clock size={16} className="text-slate-400" /> Overtime Settings
        </h2>
        <p className="text-xs text-slate-500 mb-4">
          Rates that replace base pay past the 9-hour overtime threshold. Add a second tier for a rate that steps up
          the longer overtime runs — e.g. 150% for the first 3 hours of overtime, then 200% after that.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          {(['ft_pt', 'casual'] as EmploymentCategory[]).map(category => (
            <div key={category}>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                {category === 'ft_pt' ? 'Full & part-time' : 'Casual'}
              </p>
              <ul className="divide-y divide-slate-100 text-xs mb-2">
                {tiersFor(category).map((t, i) => (
                  <li key={t.id} className="py-1.5 flex items-center justify-between gap-2">
                    <span className="text-slate-600">
                      {i === 0 ? 'From overtime start' : `After ${t.hours_into_overtime}h of overtime`}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="badge-slate font-mono">{t.percentage}%</span>
                      <button onClick={() => removeTier(t.id)} className="btn-ghost p-1 text-red-500 hover:bg-red-50">
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </li>
                ))}
                {tiersFor(category).length === 0 && (
                  <li className="py-1.5 text-slate-400">No overtime rate set — overtime won&apos;t be costed.</li>
                )}
              </ul>
              <form onSubmit={e => addTier(category, e)} className="flex gap-1.5">
                <input
                  type="number" min={0} step={0.5} placeholder="Hrs into OT" required
                  className="input text-xs px-2 py-1 w-24"
                  value={newTier[category].hours}
                  onChange={e => setNewTier(t => ({ ...t, [category]: { ...t[category], hours: e.target.value } }))}
                />
                <input
                  type="number" min={0} step={1} placeholder="%" required
                  className="input text-xs px-2 py-1 w-16"
                  value={newTier[category].pct}
                  onChange={e => setNewTier(t => ({ ...t, [category]: { ...t[category], pct: e.target.value } }))}
                />
                <button type="submit" disabled={addingTier === category} className="btn-secondary px-2 py-1">
                  {addingTier === category ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                </button>
              </form>
            </div>
          ))}
        </div>

        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Override checkboxes</p>
        <p className="text-xs text-slate-500 mb-2">
          Checked means overtime is allowed to beat that rate when overtime&apos;s percentage is higher. Unchecked
          means that rate always wins over overtime, whatever the numbers say.
        </p>
        <ul className="divide-y divide-slate-100 text-xs mb-2">
          {overrides.map(o => (
            <li key={o.category_group} className="py-1.5 flex items-center gap-2">
              <input
                type="checkbox" checked={o.overridable} disabled={savingOverride === o.category_group}
                onChange={() => toggleOverride(o)}
                className="h-3.5 w-3.5"
              />
              <span className="text-slate-600 flex-1">Override {categoryLabel(o.category_group)}</span>
              <button onClick={() => removeOverride(o.category_group)} className="btn-ghost p-1 text-red-500 hover:bg-red-50">
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
        {addableGroups.length > 0 && (
          <form onSubmit={addOverride} className="flex gap-1.5">
            <select
              className="input text-xs px-2 py-1 flex-1" value={newOverrideGroup}
              onChange={e => setNewOverrideGroup(e.target.value)}
            >
              <option value="">Add an override…</option>
              {addableGroups.map(g => <option key={g} value={g}>{categoryLabel(g)}</option>)}
            </select>
            <button type="submit" disabled={!newOverrideGroup || savingOverride === newOverrideGroup} className="btn-secondary px-2 py-1">
              <Plus size={12} />
            </button>
          </form>
        )}
      </div>

      {/* ── SMS quiet hours ─────────────────────────────────────────────── */}
      <div className="card p-5">
        <h2 className="font-semibold text-slate-800 flex items-center gap-2 mb-1">
          <Moon size={16} className="text-slate-400" /> SMS Quiet Hours
        </h2>
        <p className="text-xs text-slate-500 mb-3">
          No shift-cover texts go out in this window — set it however early or late this store actually needs. A
          genuine no-show still gets a call through regardless, since that can&apos;t wait for quiet hours to end.
          Leave both blank to allow texts at any hour.
        </p>

        <form onSubmit={saveQuietHours} className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Starts</label>
            <input
              type="time" className="input text-xs px-2 py-1.5 w-28"
              value={quietStartInput} onChange={e => setQuietStartInput(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Ends</label>
            <input
              type="time" className="input text-xs px-2 py-1.5 w-28"
              value={quietEndInput} onChange={e => setQuietEndInput(e.target.value)}
            />
          </div>
          <button type="submit" disabled={savingQuietHours} className="btn-secondary text-xs px-2 py-1.5 flex items-center gap-1">
            <Moon size={12} /> {savingQuietHours ? 'Saving…' : 'Save'}
          </button>
        </form>

        {quietHoursError && <p className="text-xs text-red-600 mt-2">{quietHoursError}</p>}

        {settings?.quiet_hours_start && settings?.quiet_hours_end ? (
          <p className="text-xs text-slate-400 mt-2">
            Currently {settings.quiet_hours_start.slice(0, 5)}–{settings.quiet_hours_end.slice(0, 5)}
            {settings.quiet_hours_start.slice(0, 5) > settings.quiet_hours_end.slice(0, 5) && ', crossing midnight'}.
          </p>
        ) : (
          <p className="text-xs text-slate-400 mt-2">No quiet hours set — texts can go out at any hour.</p>
        )}
      </div>

      {/* ── Public / school holidays ─────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
            <CalendarDays size={16} className="text-slate-400" />
            {holidayTab === 'public' ? 'Public Holidays' : 'School Holidays'}
          </h2>
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              type="button" onClick={() => setHolidayTab('public')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                holidayTab === 'public' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              Public Holidays
            </button>
            <button
              type="button" onClick={() => setHolidayTab('school')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                holidayTab === 'school' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              School Holidays
            </button>
          </div>
        </div>

        {holidayTab === 'public' ? (
          <>
            <p className="text-xs text-slate-500 mb-3">
              A shift on one of these dates is costed at the public-holiday rate, whatever day of the week it falls on.
            </p>

            <form onSubmit={saveSettings} className="flex flex-wrap items-end gap-2 mb-4 pb-4 border-b border-slate-100">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Country</label>
                <input
                  className="input text-xs px-2 py-1.5 w-28" placeholder="AU" required maxLength={2}
                  value={countryInput} onChange={e => setCountryInput(e.target.value.toUpperCase())}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">State</label>
                <input
                  className="input text-xs px-2 py-1.5 w-28" placeholder="WA"
                  value={stateInput} onChange={e => setStateInput(e.target.value.toUpperCase())}
                />
              </div>
              <button type="submit" disabled={savingSettings} className="btn-secondary text-xs px-2 py-1.5 flex items-center gap-1">
                <Globe size={12} /> {savingSettings ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button" onClick={generateHolidays} disabled={generating || !settings?.country}
                className="btn-primary text-xs px-2 py-1.5 flex items-center gap-1"
                title={!settings?.country ? 'Save a country first' : `Generate ${new Date().getFullYear()} public holidays`}
              >
                {generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                Generate {new Date().getFullYear()} holidays
              </button>
            </form>

            <div className="divide-y divide-slate-100">
              {(data?.public_holidays ?? []).map(h => (
                <div key={h.date} className="py-2 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-slate-800">{h.name}</span>
                    <span className="text-xs text-slate-500 ml-2">{formatDate(h.date)}</span>
                  </div>
                  <button onClick={() => removeHoliday(h.date)} className="btn-ghost p-1.5 text-red-500 hover:bg-red-50">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {(data?.public_holidays ?? []).length === 0 && !loading && (
                <p className="text-sm text-slate-400 py-2">No public holidays added yet.</p>
              )}
            </div>

            <form onSubmit={addHoliday} className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-2">
              <input
                type="date" className="input w-auto" required
                value={newHoliday.date} onChange={e => setNewHoliday(h => ({ ...h, date: e.target.value }))}
              />
              <input
                className="input flex-1 min-w-[160px]" placeholder="e.g. Labour Day" required
                value={newHoliday.name} onChange={e => setNewHoliday(h => ({ ...h, name: e.target.value }))}
              />
              <button type="submit" disabled={addingHoliday} className="btn-primary">
                {addingHoliday ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="text-xs text-slate-500 mb-3">
              On a weekday that falls inside none of these ranges (and isn&apos;t a public holiday), juniors are treated as in
              school and unavailable before 3pm — for Cover Shift and for manually assigning a shift.
            </p>

            <div className="flex flex-wrap items-center gap-2 mb-4 pb-4 border-b border-slate-100">
              <button
                type="button" onClick={generateSchoolHolidays} disabled={generatingSchool || !settings?.country}
                className="btn-secondary text-xs px-2 py-1.5 flex items-center gap-1"
                title={!settings?.country ? 'Save a country on the Public Holidays tab first' : 'Read school terms for this store’s country/state'}
              >
                {generatingSchool ? <Loader2 size={12} className="animate-spin" /> : <Globe size={12} />}
                Read from location
              </button>
              <UploadMenu
                disabled={stage !== null}
                options={[
                  {
                    key: 'school-capture', label: 'Capture', icon: <Camera size={14} />, accept: 'image/*', capture: 'environment',
                    onChange: e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void pickSchoolFile(file); },
                  },
                  {
                    key: 'school-image', label: 'Upload screenshot', icon: <FileText size={14} />, accept: 'image/*',
                    onChange: e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void pickSchoolFile(file); },
                  },
                  {
                    key: 'school-pdf', label: 'Upload PDF', icon: <FileSpreadsheet size={14} />, accept: 'application/pdf',
                    onChange: e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void pickSchoolFile(file); },
                  },
                ]}
              />
              <p className="text-xs text-slate-400 basis-full">
                Only some locations publish school terms in a form the app can read directly — Western Australia isn&apos;t one
                of them. Everywhere else, screenshot or save your education department&apos;s term dates page and upload it
                (or drag it anywhere onto this page) and the term dates will be turned into the holidays between them. WA&apos;s
                are at{' '}
                <a href="https://www.education.wa.edu.au/future-term-dates" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  education.wa.edu.au/future-term-dates
                </a>.
              </p>
            </div>

            <div className="divide-y divide-slate-100">
              {schoolHolidays.map(h => (
                <div key={h.id} className="py-2 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-slate-800">{h.name}</span>
                    <span className="text-xs text-slate-500 ml-2">{formatDate(h.start_date)} – {formatDate(h.end_date)}</span>
                  </div>
                  <button onClick={() => removeSchoolHoliday(h.id)} className="btn-ghost p-1.5 text-red-500 hover:bg-red-50">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {schoolHolidays.length === 0 && (
                <p className="text-sm text-slate-400 py-2">No school holidays added yet.</p>
              )}
            </div>

            <form onSubmit={addSchoolHoliday} className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-2 items-end">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Start date</label>
                <input
                  type="date" className="input w-auto" required
                  value={newSchoolHoliday.start_date} onChange={e => setNewSchoolHoliday(h => ({ ...h, start_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">End date</label>
                <input
                  type="date" className="input w-auto" required
                  value={newSchoolHoliday.end_date} onChange={e => setNewSchoolHoliday(h => ({ ...h, end_date: e.target.value }))}
                />
              </div>
              <input
                className="input flex-1 min-w-[160px]" placeholder="e.g. Term 1 holidays 2030" required
                value={newSchoolHoliday.name} onChange={e => setNewSchoolHoliday(h => ({ ...h, name: e.target.value }))}
              />
              <button type="submit" disabled={addingSchoolHoliday} className="btn-primary">
                {addingSchoolHoliday ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
              </button>
            </form>
          </>
        )}
      </div>

      {/* ── Scan preview ─────────────────────────────────────────────────── */}
      {scanned && (
        <Modal title="Base rate read from the wage table" onClose={() => setScanned(null)}>
          <div className="space-y-4 text-sm">
            <p className="text-xs text-slate-500">
              Check this against the sheet before applying — every rate the app computes is worked out from this
              one figure.
            </p>

            <div className="rounded-lg border border-slate-200 p-4 flex items-center justify-between">
              {scanned.current_rate !== null && scanned.current_rate !== scanned.rate && (
                <span className="text-slate-400 line-through mr-2">${scanned.current_rate.toFixed(2)}/hr</span>
              )}
              <span className="text-2xl font-bold text-slate-800">${scanned.rate.toFixed(2)}/hr</span>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setScanned(null)} className="btn-secondary">Cancel</button>
              <button onClick={applyScanned} disabled={applying} className="btn-primary">
                {applying ? 'Applying…' : 'Apply'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Scanned term dates preview ───────────────────────────────────── */}
      {scannedTerms && (
        <Modal title="School holidays read from that page" onClose={() => setScannedTerms(null)} size="lg">
          <div className="space-y-4 text-sm">
            <p className="text-xs text-slate-500">
              Check these against the page before applying — juniors are treated as unavailable before 3pm on every
              weekday that <em>isn&apos;t</em> covered here, so a wrong date quietly changes who can be offered shifts for
              months.
              {scannedTerms.terms_read > 0 && ` Read ${scannedTerms.terms_read} term dates${scannedTerms.region ? ` for ${scannedTerms.region}` : ''}, and turned the gaps between them into the holidays below.`}
            </p>

            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {scannedTerms.holidays.map(h => (
                <div key={h.start_date} className="px-3 py-2 flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-800">{h.name}</span>
                  <span className="text-xs text-slate-500 shrink-0">{formatDate(h.start_date)} – {formatDate(h.end_date)}</span>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setScannedTerms(null)} className="btn-secondary">Cancel</button>
              <button onClick={applyScannedTerms} disabled={applyingTerms} className="btn-primary">
                {applyingTerms ? 'Applying…' : `Apply ${scannedTerms.holidays.length} holiday${scannedTerms.holidays.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
