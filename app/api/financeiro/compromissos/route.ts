import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/supabase/server';
import { criarCompromisso } from '@/modules/financeiro/lib/compromissos';

const createSchema = z.object({
  tipo: z.enum(['pagar', 'receber']),
  descricao: z.string().min(1).max(120),
  valor_total: z.number().positive(),
  total_parcelas: z.number().int().min(1).max(48).default(1),
  recorrencia: z.enum(['unica', 'semanal', 'mensal', 'anual']).default('mensal'),
  data_vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  observacoes: z.string().nullable().optional(),
});

export async function GET() {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('compromissos')
    .select('*, parcelas:compromisso_parcelas(*)')
    .eq('user_id', userId)
    .order('pago', { ascending: true })
    .order('data_vencimento', { ascending: true, nullsFirst: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ compromissos: data ?? [] });
}

export async function POST(req: NextRequest) {
  const { userId } = await requireUser();
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos', issues: parsed.error.flatten() }, { status: 400 });
  }
  const result = await criarCompromisso(userId, {
    ...parsed.data,
    data_vencimento: parsed.data.data_vencimento ?? null,
    source: 'manual',
  });
  if (!result.ok) return NextResponse.json({ error: result.reply }, { status: 400 });
  return NextResponse.json({ ok: true, id: result.id, reply: result.reply }, { status: 201 });
}
