import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';
import { concluirTarefa } from '@/modules/tarefas/lib/acoes';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await requireUser();
  const { id } = await params;
  const result = await concluirTarefa(userId, id);
  if (!result.ok) return NextResponse.json({ error: result.reply }, { status: 400 });
  return NextResponse.json({ ok: true, reply: result.reply });
}
