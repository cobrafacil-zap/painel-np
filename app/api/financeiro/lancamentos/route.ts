import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/supabase/server';

const createSchema = z.object({
  type: z.enum(['gasto', 'receita']),
  amount: z.number().positive(),
  category: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  payment_method: z.string().nullable().optional(),
  occurred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  metadata: z.record(z.unknown()).optional(),
});

export async function GET(req: NextRequest) {
  const { userId } = await requireUser();
  const { searchParams } = new URL(req.url);

  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const type = searchParams.get('type'); // 'gasto' | 'receita' | null
  const category = searchParams.get('category');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '500', 10), 1000);

  const supabase = await createClient();
  let q = supabase
    .from('records')
    .select('*')
    .eq('user_id', userId)
    .eq('module_id', 'financeiro')
    .order('occurred_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (from) q = q.gte('occurred_at', from);
  if (to) q = q.lte('occurred_at', to);
  if (type) q = q.eq('type', type);
  if (category) q = q.eq('category', category);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ records: data ?? [] });
}

export async function POST(req: NextRequest) {
  const { userId } = await requireUser();
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos', issues: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('records')
    .insert({
      user_id: userId,
      module_id: 'financeiro',
      type: parsed.data.type,
      amount: parsed.data.amount,
      category: parsed.data.category ?? null,
      description: parsed.data.description ?? null,
      payment_method: parsed.data.payment_method ?? null,
      occurred_at: parsed.data.occurred_at,
      metadata: parsed.data.metadata ?? {},
      source: 'manual',
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ record: data }, { status: 201 });
}
