import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * PATCH /api/tarefas/ordem
 *
 * Body: { ordem: [{ id: string, ordem: number }, ...] }
 *
 * Atualiza a coluna `ordem` em batch pra um usuário. Usado pelo
 * drag-to-reorder no painel e na página de tarefas.
 */
const schema = z.object({
  ordem: z
    .array(
      z.object({
        id: z.string().uuid(),
        ordem: z.number().int().min(0).max(1000000),
      })
    )
    .min(1)
    .max(500),
});

export async function PATCH(req: NextRequest) {
  const { userId } = await requireUser();
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 });
  }

  // Update em batch (N round-trips → 1)
  const supabase = createServiceClient();
  // Como cada update é um round-trip separado, preferimos Promise.all
  const updates = await Promise.all(
    parsed.data.ordem.map((item) =>
      (supabase.from('tarefas') as any)
        .update({ ordem: item.ordem })
        .eq('id', item.id)
        .eq('user_id', userId)
    )
  );

  const erro = updates.find((r) => r.error);
  if (erro?.error) {
    return NextResponse.json({ error: erro.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, atualizadas: parsed.data.ordem.length });
}
