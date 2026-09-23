/**
 * Syncs the app's staff list against an uploaded availability sheet.
 *
 * The sheet is the source of truth for three things only: the name, the mobile
 * number and the weekly availability. Everything else the app tracks
 * (reliability, departments, role type, active flag) is left untouched, and a
 * value is only written when it actually differs from what is already stored —
 * so re-uploading an unchanged sheet is a no-op.
 *
 * Staff who no longer appear on the sheet are archived, not deleted — their
 * department links, availability and history stay intact, so if they show
 * up on a later sheet they're reinstated automatically instead of being
 * re-created as a duplicate. The route runs a preview first and only
 * applies once the change has been confirmed.
 */

import { supabaseAdmin as supabase } from './supabaseAdmin';
import { AgeGroup } from './types';
import {
  ParsedSheet, SheetStaffRow, describeLayout, parseSheet, normalizePhone, nameKey,
} from './availabilitySheet';
import { hasNameColumns } from './staffNames';
import { toE164AU } from './phone';

export interface FieldChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface PlanCreate {
  name: string;
  phone: string | null;
  age_group: AgeGroup;
  available_days: number;
}

export interface PlanUpdate {
  id: string;
  name: string;
  changes: FieldChange[];
}

export interface PlanDelete {
  id: string;
  name: string;
}

export interface SyncApplied {
  staff_created: number;
  staff_updated: number;
  staff_deleted: number;
  availability_written: number;
  availability_cleared: number;
}

export interface SyncPlan {
  mode: 'preview' | 'apply';
  layout: string | null;
  creates: PlanCreate[];
  updates: PlanUpdate[];
  deletes: PlanDelete[];
  unchanged: string[];
  warnings: string[];
  errors: string[];
  applied?: SyncApplied;
}

export interface SyncOptions {
  mode?: 'preview' | 'apply';
  /** Remove staff who are no longer listed on the sheet. Defaults to true. */
  deleteMissing?: boolean;
}

interface DbStaff {
  id: string;
  name: string;
  phone: string | null;
  phone_e164: string | null;
  archived: boolean;
  first_name?: string | null;
  last_name?: string | null;
}

interface AvailRow {
  staff_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  available: boolean;
}

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Postgres returns "06:00:00"; make every comparison use that shape. */
function normalizeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const [h = '0', m = '0', s = '0'] = value.trim().split(':');
  return [h, m, s].map(part => String(parseInt(part, 10) || 0).padStart(2, '0')).join(':');
}

function timeWindow(start?: string | null, end?: string | null): string | null {
  const s = normalizeTime(start);
  const e = normalizeTime(end);
  if (!s || !e) return null;
  return `${s.slice(0, 5)}–${e.slice(0, 5)}`;
}

/** Existing staff this sheet row refers to: by name, or by mobile if renamed. */
function matchExisting(
  row: SheetStaffRow,
  byName: Map<string, DbStaff>,
  byPhone: Map<string, DbStaff[]>,
  claimed: Set<string>
): DbStaff | undefined {
  const byNameHit = byName.get(row.key);
  if (byNameHit && !claimed.has(byNameHit.id)) return byNameHit;

  if (row.phone) {
    const candidates = (byPhone.get(row.phone) ?? []).filter(s => !claimed.has(s.id));
    if (candidates.length === 1) return candidates[0];
  }
  return undefined;
}

export async function syncStaffSheet(rows: string[][], options: SyncOptions = {}): Promise<SyncPlan> {
  const mode = options.mode ?? 'preview';
  const parsed: ParsedSheet = parseSheet(rows);

  // Part of the sheet could not be read, so absence from it proves nothing
  // about who still works here — never delete on the strength of that.
  const deleteMissing = (options.deleteMissing ?? true) && !parsed.incomplete;
  const plan: SyncPlan = {
    mode,
    layout: parsed.layout ? describeLayout(parsed.layout) : null,
    creates: [],
    updates: [],
    deletes: [],
    unchanged: [],
    warnings: [...parsed.warnings],
    errors: [...parsed.errors],
  };

  if (!parsed.staff.length) return plan;

  if (parsed.incomplete && (options.deleteMissing ?? true)) {
    plan.warnings.push(
      'Part of the sheet could not be read, so nobody was removed. Fix the rows listed above, or remove the staff member by hand.'
    );
  }

  const withNameParts = await hasNameColumns();
  if (!withNameParts) {
    plan.warnings.push(
      'The staff table has no first_name / last_name columns yet — names were stored combined. Run supabase-migrations/20260913_staff_name_parts.sql to store them separately.'
    );
  }

  const columns = withNameParts
    ? 'id, name, phone, phone_e164, archived, first_name, last_name'
    : 'id, name, phone, phone_e164, archived';
  const [staffRes, availRes] = await Promise.all([
    supabase.from('staff').select(columns),
    supabase.from('availability_templates').select('staff_id, day_of_week, start_time, end_time, available'),
  ]);

  if (staffRes.error) {
    plan.errors.push(`Could not read the staff list: ${staffRes.error.message}`);
    return plan;
  }
  if (availRes.error) {
    plan.errors.push(`Could not read existing availability: ${availRes.error.message}`);
    return plan;
  }

  const existingStaff = (staffRes.data ?? []) as unknown as DbStaff[];
  const existingAvail = (availRes.data ?? []) as AvailRow[];

  const byName = new Map<string, DbStaff>();
  const byPhone = new Map<string, DbStaff[]>();
  for (const s of existingStaff) {
    const key = nameKey(s.name ?? '');
    if (!byName.has(key)) byName.set(key, s);
    const phone = normalizePhone(s.phone);
    if (phone) byPhone.set(phone, [...(byPhone.get(phone) ?? []), s]);
  }

  const availByStaff = new Map<string, Map<number, AvailRow>>();
  for (const row of existingAvail) {
    const days = availByStaff.get(row.staff_id) ?? new Map<number, AvailRow>();
    days.set(row.day_of_week, row);
    availByStaff.set(row.staff_id, days);
  }

  // ── Build the plan ─────────────────────────────────────────────────────────
  const claimed = new Set<string>();
  const newStaff: { row: SheetStaffRow; payload: Record<string, unknown> }[] = [];
  const staffUpdates: { id: string; payload: Record<string, unknown> }[] = [];
  const availUpserts: AvailRow[] = [];
  const availClears = new Map<string, number[]>();

  for (const row of parsed.staff) {
    const existing = matchExisting(row, byName, byPhone, claimed);

    if (!existing) {
      newStaff.push({
        row,
        payload: {
          name: row.name,
          ...(withNameParts ? { first_name: row.first_name, last_name: row.last_name || null } : {}),
          phone: row.phone,
          // The sheet's mobile column is normalised to a display string
          // ("0491 570 156"), never the +61 form SMS sending needs — that
          // has to be derived separately or this person can never be texted.
          phone_e164: toE164AU(row.phone),
          age_group: row.age_group,
          role_type: 'department_only',
          reliability_score: 50,
          active: true,
        },
      });
      plan.creates.push({
        name: row.name,
        phone: row.phone,
        age_group: row.age_group,
        available_days: Object.values(row.days).filter(d => d.kind === 'available').length,
      });
      continue;
    }

    claimed.add(existing.id);
    const changes: FieldChange[] = [];
    const payload: Record<string, unknown> = {};

    // Showing up on a currently-worked roster is about as strong a signal
    // as there is that someone archived (marked as having left) is back —
    // reinstate them as part of applying this sheet rather than leaving
    // their shifts unmatched until a manager notices and does it by hand.
    if (existing.archived) {
      payload.archived = false;
      payload.archived_at = null;
      payload.active = true;
      changes.push({ field: 'Status', from: 'Archived', to: 'Active (reinstated)' });
    }

    if (existing.name !== row.name) {
      payload.name = row.name;
      changes.push({ field: 'Name', from: existing.name, to: row.name });
    }
    if (withNameParts) {
      if ((existing.first_name ?? null) !== (row.first_name || null)) {
        payload.first_name = row.first_name || null;
      }
      if ((existing.last_name ?? null) !== (row.last_name || null)) {
        payload.last_name = row.last_name || null;
      }
    }
    const existingPhone = normalizePhone(existing.phone);
    const phoneChanged = !row.phone_unreadable && existingPhone !== row.phone;
    if (phoneChanged) {
      payload.phone = row.phone;
      changes.push({ field: 'Mobile', from: existing.phone ?? null, to: row.phone });
    }

    // phone_e164 is derived, not read off the sheet, so it needs recomputing
    // whenever the number itself changes — and also backfilling for a
    // record stuck without one from before this derivation existed, even
    // when this particular sheet's number happens to match what's on file.
    if (!row.phone_unreadable && row.phone) {
      const e164 = toE164AU(row.phone);
      if (e164 && e164 !== existing.phone_e164 && (phoneChanged || !existing.phone_e164)) {
        payload.phone_e164 = e164;
        if (!phoneChanged) changes.push({ field: 'Mobile (SMS format)', from: existing.phone_e164 ?? 'missing', to: e164 });
      }
    }

    // Availability, day by day. Unreadable cells are left exactly as they are.
    const currentDays = availByStaff.get(existing.id) ?? new Map<number, AvailRow>();
    for (let day = 0; day < 7; day++) {
      const cell = row.days[day];
      const current = currentDays.get(day);

      if (cell.kind === 'available') {
        const sameTimes =
          current &&
          normalizeTime(current.start_time) === cell.start_time &&
          normalizeTime(current.end_time) === cell.end_time &&
          current.available;
        if (sameTimes) continue;

        availUpserts.push({
          staff_id: existing.id,
          day_of_week: day,
          start_time: cell.start_time!,
          end_time: cell.end_time!,
          available: true,
        });
        changes.push({
          field: DAY_LABELS[day],
          from: current?.available ? timeWindow(current.start_time, current.end_time) : null,
          to: timeWindow(cell.start_time, cell.end_time),
        });
      } else if (cell.kind === 'unavailable' && current) {
        availClears.set(existing.id, [...(availClears.get(existing.id) ?? []), day]);
        changes.push({
          field: DAY_LABELS[day],
          from: current.available ? timeWindow(current.start_time, current.end_time) : null,
          to: null,
        });
      }
    }

    if (Object.keys(payload).length) staffUpdates.push({ id: existing.id, payload });

    if (changes.length) plan.updates.push({ id: existing.id, name: row.name, changes });
    else plan.unchanged.push(row.name);
  }

  // Someone already archived not appearing on this sheet says nothing new —
  // they're already known to have left. Only flag people newly missing.
  const missing = existingStaff.filter(s => !claimed.has(s.id) && !s.archived);
  if (deleteMissing) {
    plan.deletes = missing.map(s => ({ id: s.id, name: s.name }));
  } else if (missing.length) {
    plan.warnings.push(
      `${missing.length} staff member(s) are not on this sheet and were kept: ${missing.map(s => s.name).join(', ')}.`
    );
  }

  if (mode === 'preview') return plan;

  // ── Apply ──────────────────────────────────────────────────────────────────
  const applied: SyncApplied = {
    staff_created: 0,
    staff_updated: 0,
    staff_deleted: 0,
    availability_written: 0,
    availability_cleared: 0,
  };

  if (newStaff.length) {
    const { data, error } = await supabase
      .from('staff')
      .insert(newStaff.map(s => s.payload))
      .select('id, name');

    if (error) {
      plan.errors.push(`Could not add new staff: ${error.message}`);
    } else {
      applied.staff_created = data?.length ?? 0;
      const createdIds = new Map((data ?? []).map(s => [nameKey(s.name), s.id]));
      for (const { row } of newStaff) {
        const id = createdIds.get(row.key);
        if (!id) continue;
        for (let day = 0; day < 7; day++) {
          const cell = row.days[day];
          if (cell.kind !== 'available') continue;
          availUpserts.push({
            staff_id: id,
            day_of_week: day,
            start_time: cell.start_time!,
            end_time: cell.end_time!,
            available: true,
          });
        }
      }
    }
  }

  for (const update of staffUpdates) {
    const { error } = await supabase.from('staff').update(update.payload).eq('id', update.id);
    if (error) plan.errors.push(`Could not update staff ${update.id}: ${error.message}`);
    else applied.staff_updated++;
  }

  if (availUpserts.length) {
    const { error } = await supabase
      .from('availability_templates')
      .upsert(availUpserts, { onConflict: 'staff_id,day_of_week' });
    if (error) plan.errors.push(`Could not save availability: ${error.message}`);
    else applied.availability_written = availUpserts.length;
  }

  for (const [staffId, days] of Array.from(availClears.entries())) {
    const { error } = await supabase
      .from('availability_templates')
      .delete()
      .eq('staff_id', staffId)
      .in('day_of_week', days);
    if (error) plan.errors.push(`Could not clear availability for ${staffId}: ${error.message}`);
    else applied.availability_cleared += days.length;
  }

  if (plan.deletes.length) {
    // Archived, not deleted — their department links, availability and
    // shift/reliability history stay intact so reinstating them (by hand,
    // or automatically above if they reappear on a later sheet) restores
    // everything instantly instead of re-entering them from scratch.
    const ids = plan.deletes.map(d => d.id);
    const { error } = await supabase
      .from('staff')
      .update({ archived: true, archived_at: new Date().toISOString(), active: false })
      .in('id', ids);
    if (error) plan.errors.push(`Could not archive staff who left the sheet: ${error.message}`);
    else applied.staff_deleted = ids.length;
  }

  plan.applied = applied;
  return plan;
}
