import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';

const BUCKET = 'leave-forms';
/** Signed URLs are handed straight to the browser for viewing/downloading —
 *  long enough to actually use, short enough not to matter if one leaks. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Request Day Off / Leave forms — a scanned or photographed form staff hand
 * in, kept on file against a date range. Never parsed: the file is just
 * stored, and the date range is what actually excludes them from claim-race
 * eligibility (see @/lib/eligibility).
 */
export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { searchParams } = new URL(req.url);
  const staff_id = searchParams.get('staff_id');

  let query = supabase
    .from('staff_leave')
    .select(`*, staff ( id, name )`)
    .order('start_date', { ascending: false });
  if (staff_id) query = query.eq('staff_id', staff_id);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = await Promise.all(
    (data ?? []).map(async (row: { file_path: string | null }) => {
      if (!row.file_path) return { ...row, file_url: null };
      const { data: signed } = await supabase.storage
        .from(BUCKET).createSignedUrl(row.file_path, SIGNED_URL_TTL_SECONDS);
      return { ...row, file_url: signed?.signedUrl ?? null };
    })
  );

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const form = await req.formData();
  const staff_id = form.get('staff_id');
  const leave_type = form.get('leave_type');
  const start_date = form.get('start_date');
  const end_date = form.get('end_date');
  const notes = form.get('notes');
  const file = form.get('file');

  if (typeof staff_id !== 'string' || !staff_id)
    return NextResponse.json({ error: 'staff_id required' }, { status: 400 });
  if (leave_type !== 'day_off' && leave_type !== 'leave')
    return NextResponse.json({ error: "leave_type must be 'day_off' or 'leave'" }, { status: 400 });
  if (typeof start_date !== 'string' || !start_date || typeof end_date !== 'string' || !end_date)
    return NextResponse.json({ error: 'start_date and end_date required' }, { status: 400 });
  if (end_date < start_date)
    return NextResponse.json({ error: 'end_date cannot be before start_date' }, { status: 400 });

  let file_path: string | null = null;
  let file_name: string | null = null;

  if (file instanceof File && file.size > 0) {
    const bytes = Buffer.from(await file.arrayBuffer());
    // Timestamped so two uploads for the same person never collide, and
    // nested under their id so a bucket listing is at least sorted by who.
    const path = `${staff_id}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET).upload(path, bytes, { contentType: file.type || 'application/octet-stream' });
    if (uploadErr) return NextResponse.json({ error: `Could not upload file: ${uploadErr.message}` }, { status: 500 });
    file_path = path;
    file_name = file.name;
  }

  const { data, error } = await supabase
    .from('staff_leave')
    .insert([{
      staff_id, leave_type, start_date, end_date,
      file_path, file_name,
      notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
    }])
    .select(`*, staff ( id, name )`)
    .single();

  if (error) {
    // Roll back the upload rather than leave an orphaned file with no record.
    if (file_path) await supabase.storage.from(BUCKET).remove([file_path]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
