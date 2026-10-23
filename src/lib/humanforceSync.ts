import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from './supabaseAdmin';
import { planHumanforceSync, SyncEntry, SyncShift } from './humanforcePlan';
import type { AutomationFlag } from './automationFlags';

export const SYNC_PROTOCOL = 'humanforce-replace-v2';

export async function readAutomationBody(req: Request, limit: number) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error('Request body is required.');
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit) { await reader.cancel(); throw new Error('Request body is too large.'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}

export async function reconcileHumanforce(date: string, entries: SyncEntry[], dryRun: boolean, initialFlags: AutomationFlag[] = []) {
  const [deptRes, staffRes, shiftRes] = await Promise.all([
    supabase.from('departments').select('id, name').range(0, 999),
    supabase.from('staff').select('id, name, active').range(0, 999),
    supabase.from('shifts').select('*').eq('date', date).order('id').range(0, 999),
  ]);
  if (deptRes.error || staffRes.error || shiftRes.error || [deptRes, staffRes, shiftRes].some(r => (r.data?.length ?? 0) >= 1000)) {
    return NextResponse.json({ error: 'Could not read reconciliation data; nothing applied.' }, { status: 503 });
  }
  const plan = planHumanforceSync(entries, staffRes.data ?? [], deptRes.data ?? [], (shiftRes.data ?? []) as SyncShift[]);
  const flags = [...initialFlags, ...plan.flags];
  if (!entries.length) flags.push({ department: null, kind: 'empty_read', message: 'No in-scope people could be read; nothing applied.' });
  const { data, error } = await supabase.rpc('replace_humanforce_roster', {
    p_date: date, p_shifts: plan.desired, p_flags: flags, p_expected: shiftRes.data ?? [], p_dry_run: dryRun,
  });
  if (error) return NextResponse.json({ error: 'Roster replacement transaction unavailable or failed; nothing applied. Apply the replacement migration.', protocol: SYNC_PROTOCOL }, { status: 503 });
  return NextResponse.json({ protocol: SYNC_PROTOCOL, date, dry_run: dryRun, duplicates: plan.duplicates,
    proposed_shifts: plan.creates.length, proposed_deletions: plan.removeIds.length, source_shifts: plan.desired.length, ...data });
}
