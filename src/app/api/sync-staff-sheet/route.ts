import { NextRequest, NextResponse } from 'next/server';
import { syncStaffSheet } from '@/lib/staffSync';
import { isAvailabilitySheet } from '@/lib/availabilitySheet';

/**
 * Sync the staff list against an uploaded availability sheet.
 *
 * Body: { rows: string[][], mode?: 'preview' | 'apply', deleteMissing?: boolean }
 *
 * `rows` is the sheet exactly as it appears in the file (header row included,
 * no key mapping), because the name header is merged across two columns and the
 * section banner rows would otherwise be read as people.
 *
 * `mode` defaults to 'preview', which reports what would change without
 * touching anything — staff missing from the sheet are deleted on apply, so the
 * caller is expected to confirm the preview first.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const rows: string[][] = body?.rows;
  const mode: 'preview' | 'apply' = body?.mode === 'apply' ? 'apply' : 'preview';
  const deleteMissing: boolean = body?.deleteMissing ?? true;

  if (!Array.isArray(rows) || !rows.length) {
    return NextResponse.json({ error: 'No rows provided' }, { status: 400 });
  }
  if (!rows.every(Array.isArray)) {
    return NextResponse.json(
      { error: 'rows must be an array of arrays — the sheet as-is, including its header row' },
      { status: 400 }
    );
  }
  if (!isAvailabilitySheet(rows)) {
    return NextResponse.json(
      { error: 'This file does not look like the availability sheet — no header row with the days of the week was found.' },
      { status: 400 }
    );
  }

  const plan = await syncStaffSheet(rows, { mode, deleteMissing });
  return NextResponse.json(plan);
}
