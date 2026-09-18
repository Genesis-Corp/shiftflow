import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireUser, unauthorized } from '@/lib/auth';

/** Which time-of-week rate categories overtime is (or isn't) allowed to beat.
 *  A category with no row here competes normally — the higher percentage
 *  wins. A row with overridable: false means that category's rate always
 *  wins over overtime, whatever the numbers say — e.g. Sunday penalty rates
 *  that overtime should never undercut. */

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const category_group = typeof body?.category_group === 'string' ? body.category_group.trim() : '';
  const label = typeof body?.label === 'string' ? body.label.trim() : '';
  const overridable = Boolean(body?.overridable);

  if (!category_group) return NextResponse.json({ error: 'category_group is required.' }, { status: 400 });
  if (!label) return NextResponse.json({ error: 'label is required.' }, { status: 400 });

  const { data, error } = await supabase
    .from('overtime_overrides')
    .upsert([{ category_group, label, overridable }], { onConflict: 'category_group' })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const category_group = new URL(req.url).searchParams.get('category_group');
  if (!category_group) return NextResponse.json({ error: 'category_group is required.' }, { status: 400 });

  const { error } = await supabase.from('overtime_overrides').delete().eq('category_group', category_group);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
