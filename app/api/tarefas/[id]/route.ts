import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/supabase/server';
import { editarTarefa, deletarTarefa } from '@/modules/tarefas/lib/acoes';

const updateSchema = z.object({
  titulo: z.string().min(1).max(120).optional(),
  descricao: z.string().nullable().optional(),
  data_prazo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  hora_prazo: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .nullable()
    .optional(),
  categoria: z.string().max(60).nullable().optional(),
  prioridade: z.enum(['baixa', 'media', 'alta']).optional(),
  recorrencia: z.enum(['semanal', 'mensal']).nullable().optional(),
  status: z.enum(['pendente', 'concluida', 'cancelada']).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await requireUser();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Dados inválidos', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Se vier 'status' usar caminho direto (sem regenerar lembrete).
  if (parsed.data.status) {
    const supabase = await createClient();
    const { error } = await supabase
      .from('tarefas')
      .update({ status: parsed.data.status })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const { status: _omit, ...patch } = parsed.data;
  const result = await editarTarefa(userId, id, patch);
  if (!result.ok) return NextResponse.json({ error: result.reply }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await requireUser();
  const { id } = await params;
  const result = await deletarTarefa(userId, id);
  if (!result.ok) return NextResponse.json({ error: result.reply }, { status: 500 });
  return NextResponse.json({ ok: true });
}
