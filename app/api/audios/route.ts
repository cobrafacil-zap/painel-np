import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';
import { listAudios } from '@/lib/audio-storage';

/**
 * GET /api/audios?q=<texto>&topic=<tag>&limit=20&offset=0
 *
 * Lista áudios com paginação + busca textual PT-BR (FTS) + filtro por
 * tópico. Cada item já vem com `signed_url` válida por 24h.
 *
 * Autenticação: requer usuário logado. Sem service role — usa o client
 * do user (já passa pelo RLS).
 */
export async function GET(req: NextRequest) {
  const { userId } = await requireUser();
  const { searchParams } = new URL(req.url);

  const q = searchParams.get('q');
  const topic = searchParams.get('topic');
  const limit = parseInt(searchParams.get('limit') ?? '20', 10);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);

  try {
    const result = await listAudios({
      userId,
      search: q,
      topic,
      limit,
      offset,
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro ao listar áudios';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
