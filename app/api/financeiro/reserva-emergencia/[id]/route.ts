/**
 * DELETE /api/financeiro/reserva-emergencia/[id]
 *
 * Remove um depósito da reserva (delete físico).
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';
import { removerDeposito, somaDepositos } from '@/lib/financeiro/reserva-emergencia-db';

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { userId } = await requireUser();
  const { id } = await ctx.params;

  const ok = await removerDeposito(userId, id);
  if (!ok) {
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 });
  }

  const novoTotal = await somaDepositos(userId);
  return NextResponse.json({ ok: true, total_depositado: Math.round(novoTotal * 100) / 100 });
}
