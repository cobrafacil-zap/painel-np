import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/supabase/server';
import { marcarParcelaPaga } from '@/modules/financeiro/lib/compromissos';

const updateSchema = z.object({
  descricao: z.string().min(1).max(120).optional(),
  valor_total: z.number().positive().optional(),
  data_vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  observacoes: z.string().nullable().optional(),
});

const pagarSchema = z.object({
  parcela_id: z.string().uuid().optional(),
  parcela_numero: z.number().int().positive().optional(),
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
    .from('compromissos')
    .update(parsed.data)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 });
  return NextResponse.json({ ok: true, compromisso: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireUser();
  const { id } = await params;
  const supabase = await createClient();
  const { error } = await supabase.from('compromissos').delete().eq('id', id).eq('user_id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/**
 * POST /api/financeiro/compromissos/[id]
 * Body: { parcela_id?: string, parcela_numero?: number }
 * Marca a parcela como paga. Se só o id do compromisso for passado,
 * marca a próxima parcela pendente.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireUser();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = pagarSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 });
  }

  const supabase = await createClient();
  let parcelaId = parsed.data.parcela_id;

  if (!parcelaId) {
    if (parsed.data.parcela_numero) {
      const { data } = await supabase
        .from('compromisso_parcelas')
        .select('id')
        .eq('user_id', userId)
        .eq('compromisso_id', id)
        .eq('numero', parsed.data.parcela_numero)
        .maybeSingle();
      parcelaId = data?.id;
    } else {
      const { data } = await supabase
        .from('compromisso_parcelas')
        .select('id')
        .eq('user_id', userId)
        .eq('compromisso_id', id)
        .eq('pago', false)
        .order('numero', { ascending: true })
        .limit(1)
        .maybeSingle();
      parcelaId = data?.id;
    }
  }

  if (!parcelaId) return NextResponse.json({ error: 'Nenhuma parcela pendente' }, { status: 404 });

  const result = await marcarParcelaPaga(parcelaId, userId);
  if (!result.ok) return NextResponse.json({ error: result.reply }, { status: 400 });
  return NextResponse.json({ ok: true, reply: result.reply });
}
