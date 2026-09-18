'use client';

import { useCallback, useEffect, useState } from 'react';
import { Camera, FileText, FileSpreadsheet, Table2, Loader2, Trash2, Plus, AlertTriangle, DollarSign } from 'lucide-react';
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
import { DAY_SHORT } from '@/lib/shiftUtils';
import Papa from 'papaparse';
import type { PenaltyRule } from '@/lib/wages';

interface WageStaff {
  id: string;
  name: string;
  age_group: 'junior' | 'senior';
  active: boolean;
  base_hourly_rate: number | null;
}

interface ScanPlan {
  matched: { staff_id: string; name: string; rate: number; current_rate: number | null }[];
  unmatched: { name: string; rate: number }[];
  warnings: string[];
}

const NEW_RULE = { name: '', days: [] as number[], start_time: '00:00', end_time: '24:00', multiplier: '1.25' };

/**
 * Hourly rates and the loadings applied on top of them.
 *
 * These numbers decide who a manager calls in, so the sheet can be read from
 * a photo but never applied straight from one — the scan is always previewed
 * against the current rates first.
 */
export default function WageTable() {
  const [staff, setStaff] = useState<WageStaff[]>([]);
  const [rules, setRules] = useState<PenaltyRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const [stage, setStage] = useState<ProgressStage | null>(null);
  const [plan, setPlan] = useState<ScanPlan | null>(null);
  const [applying, setApplying] = useState(false);

  const [newRule, setNewRule] = useState(NEW_RULE);
  const [addingRule, setAddingRule] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchJson<{ staff: WageStaff[]; rules: PenaltyRule[] }>('/api/wages');
      setStaff(data.staff);
      setRules(data.rules);
      setDrafts(Object.fromEntries(
        data.staff.map(s => [s.id, s.base_hourly_rate === null ? '' : String(s.base_hourly_rate)])
      ));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load wages');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveRate(id: string) {
    const value = drafts[id] ?? '';
    const original = staff.find(s => s.id === id)?.base_hourly_rate;
    if (value === (original === null || original === undefined ? '' : String(original))) return;

    setSaving(id);
    const put = await fetch('/api/wages', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staff_id: id, base_hourly_rate: value === '' ? null : value }),
    });
    setSaving(null);
    if (!put.ok) {
      const data = await put.json().catch(() => ({}));
      setError(data.error ?? 'Could not save that rate');
      return;
    }
    setStaff(current => current.map(s =>
      s.id === id ? { ...s, base_hourly_rate: value === '' ? null : Number(value) } : s
    ));
  }

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
        const scan = await postJson<ScanPlan>('/api/scan-wages', { csv: result.data }, { timeoutMs: 30_000 });
        setStage(null);
        if (!scan.ok || !scan.data) { setError(scan.error ?? 'Could not read that CSV.'); return; }
        setPlan(scan.data);
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
        scan = await postJson<ScanPlan>('/api/scan-wages', { pdf }, { timeoutMs: 70_000 });
      } else {
        setStage(STAGES.preparing);
        const { base64, mediaType } = await downscalePhoto(file);
        setStage(STAGES.reading);
        scan = await postJson<ScanPlan>('/api/scan-wages', { image: base64, mediaType }, { timeoutMs: 70_000 });
      }
      if (!scan.ok || !scan.data) { setError(scan.error ?? 'Could not read that wage sheet.'); return; }
      setPlan(scan.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that wage sheet.');
    } finally {
      setStage(null);
    }
  }

  async function applyPlan() {
    if (!plan) return;
    setApplying(true);
    const res = await postJson<{ applied: number }>('/api/wages', {
      rates: plan.matched.map(m => ({ staff_id: m.staff_id, base_hourly_rate: m.rate })),
    });
    setApplying(false);
    setPlan(null);
    if (!res.ok) { setError(res.error ?? 'Could not apply those rates'); return; }
    load();
  }

  async function toggleRule(rule: PenaltyRule) {
    await fetch('/api/wages/rules', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rule.id, active: !rule.active }),
    });
    load();
  }

  async function deleteRule(rule: PenaltyRule) {
    if (!confirm(`Delete the "${rule.name}" loading?`)) return;
    await fetch(`/api/wages/rules?id=${rule.id}`, { method: 'DELETE' });
    load();
  }

  async function addRule(e: React.FormEvent) {
    e.preventDefault();
    setAddingRule(true);
    const res = await postJson('/api/wages/rules', { ...newRule, multiplier: Number(newRule.multiplier), active: true });
    setAddingRule(false);
    if (!res.ok) { setError(res.error ?? 'Could not add that loading'); return; }
    setNewRule(NEW_RULE);
    load();
  }

  const missingRates = staff.filter(s => s.active && s.base_hourly_rate === null).length;

  const { dragging, dropHandlers } = useFileDrop(files => {
    for (const file of files) pickFile(file);
  }, stage !== null);

  return (
    <div className="space-y-6" {...dropHandlers}>
      <DropOverlay active={dragging} label="Drop a wage sheet photo or PDF to import" />
      {stage && <ProgressBar stage={stage} />}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-start gap-2">
          <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {/* ── Hourly rates ─────────────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div>
            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
              <DollarSign size={16} className="text-slate-400" /> Hourly rates
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              What each person is paid per ordinary hour. Used to cost a shift when finding cover.
            </p>
          </div>
          <UploadMenu
            disabled={stage !== null}
            options={[
              {
                key: 'capture',
                label: 'Capture',
                icon: <Camera size={14} />,
                accept: 'image/*',
                capture: 'environment',
                onChange: e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) pickFile(file); },
              },
              {
                key: 'upload',
                label: 'Upload',
                icon: <FileText size={14} />,
                accept: 'image/*',
                onChange: e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) pickFile(file); },
              },
              {
                key: 'pdf',
                label: 'Upload PDF',
                icon: <FileSpreadsheet size={14} />,
                accept: 'application/pdf',
                onChange: e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) pickFile(file); },
              },
              {
                key: 'csv',
                label: 'Upload CSV',
                icon: <Table2 size={14} />,
                accept: '.csv,text/csv',
                onChange: e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) pickFile(file); },
              },
            ]}
          />
        </div>

        {missingRates > 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
            {missingRates} active staff have no rate set — they&apos;ll show as &quot;no rate&quot; instead of a cost when finding cover.
          </p>
        )}

        {loading ? <p className="text-slate-400 text-sm">Loading…</p> : (
          <div className="divide-y divide-slate-100">
            {staff.map(s => (
              <div key={s.id} className={`py-2 flex items-center gap-3 ${!s.active ? 'opacity-50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-slate-800">{s.name}</span>
                  <span className={`ml-2 ${s.age_group === 'senior' ? 'badge-blue' : 'badge-amber'}`}>
                    {s.age_group === 'senior' ? 'Senior' : 'Junior'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-slate-400 text-sm">$</span>
                  <input
                    type="number" step="0.01" min="0" placeholder="—"
                    className="input w-24 text-right py-1"
                    value={drafts[s.id] ?? ''}
                    onChange={e => setDrafts(d => ({ ...d, [s.id]: e.target.value }))}
                    onBlur={() => saveRate(s.id)}
                  />
                  <span className="text-slate-400 text-xs w-8">
                    {saving === s.id ? <Loader2 size={12} className="animate-spin" /> : '/hr'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Penalty loadings ─────────────────────────────────────────────── */}
      <div className="card p-5">
        <h2 className="font-semibold text-slate-800 mb-1">Penalty loadings</h2>
        <p className="text-xs text-slate-500 mb-3">
          When a higher rate applies. Two loadings covering the same hour don&apos;t stack — the higher one wins.
        </p>

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 mb-3">
          <strong>Check these against your actual agreement.</strong> They were seeded with ordinary retail-award
          shapes as a starting point, not Farmer Jack&apos;s real rates. A wrong multiplier here produces a wrong
          cost, and the cost is what someone picks on.
        </div>

        <div className="divide-y divide-slate-100">
          {rules.map(r => (
            <div key={r.id} className={`py-2.5 flex items-center gap-3 ${!r.active ? 'opacity-50' : ''}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800">{r.name}</p>
                <p className="text-xs text-slate-500">
                  {r.days.length === 7 ? 'Every day' : r.days.map(d => DAY_SHORT[d]).join(', ')}
                  {' · '}{r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}
                </p>
              </div>
              <span className="badge-slate font-mono">×{Number(r.multiplier).toFixed(2)}</span>
              <button onClick={() => toggleRule(r)} className="btn-ghost text-xs px-2">
                {r.active ? 'On' : 'Off'}
              </button>
              <button onClick={() => deleteRule(r)} className="btn-ghost p-1.5 text-red-500 hover:bg-red-50">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {rules.length === 0 && !loading && (
            <p className="text-sm text-slate-400 py-2">No loadings — every hour is costed at the ordinary rate.</p>
          )}
        </div>

        <form onSubmit={addRule} className="mt-4 pt-4 border-t border-slate-100 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <input
              className="input col-span-2 sm:col-span-1" placeholder="Name, e.g. Sunday" required
              value={newRule.name} onChange={e => setNewRule(r => ({ ...r, name: e.target.value }))}
            />
            <input
              type="time" className="input" value={newRule.start_time}
              onChange={e => setNewRule(r => ({ ...r, start_time: e.target.value }))}
            />
            <input
              type="time" className="input" value={newRule.end_time}
              onChange={e => setNewRule(r => ({ ...r, end_time: e.target.value }))}
            />
            <input
              type="number" step="0.01" min="0.01" className="input" placeholder="1.25" required
              value={newRule.multiplier} onChange={e => setNewRule(r => ({ ...r, multiplier: e.target.value }))}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {DAY_SHORT.map((label, day) => (
              <button
                key={label} type="button"
                onClick={() => setNewRule(r => ({
                  ...r,
                  days: r.days.includes(day) ? r.days.filter(d => d !== day) : [...r.days, day].sort(),
                }))}
                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                  newRule.days.includes(day)
                    ? 'border-blue-400 bg-blue-50 text-blue-700'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
            <button type="submit" disabled={addingRule || !newRule.days.length} className="btn-primary ml-auto">
              {addingRule ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add loading
            </button>
          </div>
        </form>
      </div>

      {/* ── Scan preview ─────────────────────────────────────────────────── */}
      {plan && (
        <Modal title="Rates read from the sheet" onClose={() => setPlan(null)} size="lg">
          <div className="space-y-4 text-sm">
            <p className="text-xs text-slate-500">
              Check every figure against the sheet before applying — a misread digit here changes who gets called in.
            </p>

            {plan.matched.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {plan.matched.map(m => (
                  <li key={m.staff_id} className="px-3 py-2 flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-700 truncate">{m.name}</span>
                    <span className="text-xs shrink-0">
                      {m.current_rate !== null && m.current_rate !== m.rate && (
                        <span className="text-slate-400 line-through mr-1.5">${m.current_rate.toFixed(2)}</span>
                      )}
                      <span className={m.current_rate === m.rate ? 'text-slate-400' : 'font-semibold text-slate-800'}>
                        ${m.rate.toFixed(2)}/hr
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {plan.unmatched.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-900 mb-1">
                  Not on the staff list — set these by hand:
                </p>
                <ul className="text-xs text-amber-800 space-y-0.5">
                  {plan.unmatched.map(u => <li key={u.name}>{u.name} — ${u.rate.toFixed(2)}/hr</li>)}
                </ul>
              </div>
            )}

            {plan.warnings.length > 0 && (
              <ul className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
                {plan.warnings.map((w, i) => <li key={i} className="text-xs text-amber-800">{w}</li>)}
              </ul>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setPlan(null)} className="btn-secondary">Cancel</button>
              <button onClick={applyPlan} disabled={applying || !plan.matched.length} className="btn-primary">
                {applying ? 'Applying…' : `Apply ${plan.matched.length} rate${plan.matched.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
