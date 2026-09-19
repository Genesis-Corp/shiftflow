import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';

const BUCKET = 'leave-forms';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { data: existing } = await supabase
    .from('staff_leave').select('file_path').eq('id', params.id).maybeSingle();

  const { error } = await supabase.from('staff_leave').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (existing?.file_path) await supabase.storage.from(BUCKET).remove([existing.file_path]);

  return NextResponse.json({ success: true });
}
