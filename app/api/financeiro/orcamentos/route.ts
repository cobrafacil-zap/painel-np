import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/supabase/server';

const upsertSchema = z.object({
  category_slug: z.string().min(1),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  amount: z.number().nonnegative(),
});

export async function GET(req: NextRequest) {
  const { userId } = await requireUser();
  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period'); // YYYY-MM

  const supabase = await createClient();
  let q = supabase.from('budgets').select('*').eq('user_id', userId);
  if (period) q = q.eq('period', period);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ budgets: data ?? [] });
}

export async function POST(req: NextRequest) {
  const { userId } = await requireUser();
  const body = await req.json().catch(() => ({}));
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos', issues: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('budgets')
    .upsert(
      { user_id: userId, ...parsed.data },
      { onConflict: 'user_id,category_slug,period' }
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ budget: data }, { status: 201 });
}
