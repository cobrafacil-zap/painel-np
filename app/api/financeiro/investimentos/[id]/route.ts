/**
 * DELETE /api/financeiro/investimentos/[id]
 *
 * Remove um aporte de investimento (delete físico — correção manual).
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';
import { removerDeposito } from '@/lib/financeiro/investimentos-db';

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
  return NextResponse.json({ ok: true });
}
