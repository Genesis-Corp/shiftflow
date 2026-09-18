'use client';

import { useCallback, useEffect, useState } from 'react';
import { Camera, FileText, FileSpreadsheet, Table2, Loader2, Trash2, Plus, AlertTriangle, DollarSign, CalendarDays } from 'lucide-react';
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
import type { AgeBracket, TimeLoading } from '@/lib/wages';

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
}

interface ScanResult {
  rate: number;
  current_rate: number | null;
}

const EMPTY_HOLIDAY = { date: '', name: '' };

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

  const [newHoliday, setNewHoliday] = useState(EMPTY_HOLIDAY);
  const [addingHoliday, setAddingHoliday] = useState(false);

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

  useEffect(() => { load(); }, [load]);

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

  const { dragging, dropHandlers } = useFileDrop(files => {
    for (const file of files) pickFile(file);
  }, stage !== null);

  const ftPtLoadings = (data?.time_loadings ?? []).filter(l => l.employment_category === 'ft_pt');
  const casualLoadings = (data?.time_loadings ?? []).filter(l => l.employment_category === 'casual');

  function loadingLabel(l: TimeLoading): string {
    if (l.is_public_holiday) return 'Public holiday';
    if (l.is_overtime) return 'Overtime (after 9h in a shift)';
    const days = l.days.length === 6 ? 'Mon-Sat' : l.days.map(d => DAY_SHORT[d]).join(', ');
    return `${l.label} — ${days} ${l.start_time.slice(0, 5)}–${l.end_time.slice(0, 5)}`;
  }

  return (
    <div className="space-y-6" {...dropHandlers}>
      <DropOverlay active={dragging} label="Drop the wage table photo, PDF or CSV to read its base rate" />
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

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 mb-4">
          Weekly overtime (38h/week) and &quot;in charge&quot; premiums aren&apos;t computed yet — only per-shift
          overtime (past 9 hours) and the age/time-of-week rates above are. A shift relying on either of those will
          show as slightly under its real cost.
        </div>

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

      {/* ── Public holidays ──────────────────────────────────────────────── */}
      <div className="card p-5">
        <h2 className="font-semibold text-slate-800 flex items-center gap-2 mb-1">
          <CalendarDays size={16} className="text-slate-400" /> Public Holidays
        </h2>
        <p className="text-xs text-slate-500 mb-3">
          A shift on one of these dates is costed at the public-holiday rate, whatever day of the week it falls on.
        </p>

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
    </div>
  );
}
