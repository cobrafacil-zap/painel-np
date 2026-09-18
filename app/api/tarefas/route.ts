import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/supabase/server';
import { criarTarefa, listarTarefas } from '@/modules/tarefas/lib/acoes';

const createSchema = z.object({
  texto_original: z.string().min(1).max(2000).optional(),
  titulo: z.string().min(1).max(120),
  descricao: z.string().nullable().optional(),
  data_prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora_prazo: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .nullable()
    .optional(),
  tipo: z.enum(['compromisso', 'prazo']).optional(),
  categoria: z.string().max(60).nullable().optional(),
  prioridade: z.enum(['baixa', 'media', 'alta']).default('media'),
  recorrencia: z.enum(['semanal', 'mensal']).nullable().optional(),
});

export async function GET(req: NextRequest) {
  const { userId } = await requireUser();
  const status = req.nextUrl.searchParams.get('status') ?? 'todas';
  const tarefas = await listarTarefas(userId, {
    status: status as 'pendente' | 'concluida' | 'cancelada' | 'todas',
    limite: 200,
  });
  return NextResponse.json({ tarefas });
}

export async function POST(req: NextRequest) {
  const { userId } = await requireUser();
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Dados inválidos', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const hora = parsed.data.hora_prazo ?? null;
  // Regra: tipo inferido de hora_prazo NOT NULL → compromisso.
  const tipo: 'compromisso' | 'prazo' = parsed.data.tipo ?? (hora ? 'compromisso' : 'prazo');

  const result = await criarTarefa(userId, {
    texto_original: parsed.data.texto_original ?? parsed.data.titulo,
    titulo: parsed.data.titulo,
    descricao: parsed.data.descricao ?? null,
    data_prazo: parsed.data.data_prazo,
    hora_prazo: hora,
    tipo,
    categoria: parsed.data.categoria ?? null,
    prioridade: parsed.data.prioridade,
    recorrencia: parsed.data.recorrencia ?? null,
    source: 'manual',
  });

  if (!result.ok) return NextResponse.json({ error: result.reply }, { status: 400 });
  return NextResponse.json({ ok: true, id: result.id, reply: result.reply }, { status: 201 });
}
