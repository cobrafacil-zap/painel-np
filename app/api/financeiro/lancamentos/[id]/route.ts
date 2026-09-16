import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/supabase/server';

const updateSchema = z.object({
  type: z.enum(['gasto', 'receita']).optional(),
  amount: z.number().positive().optional(),
  category: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  payment_method: z.string().nullable().optional(),
  occurred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireUser();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos', issues: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('records')
    .update(parsed.data)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 });
  return NextResponse.json({ record: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireUser();
  const { id } = await params;

  const supabase = await createClient();
  const { error } = await supabase.from('records').delete().eq('id', id).eq('user_id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
