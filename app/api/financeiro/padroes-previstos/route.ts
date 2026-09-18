import { NextRequest, NextResponse } from 'next/server';
import { createClient, requireUser } from '@/lib/supabase/server';
import { listarPadroesFuturos } from '@/lib/financeiro/patterns';

/**
 * GET /api/financeiro/padroes-previstos
 * Retorna os próximos N padrões previstos pelo job de padrões (#1).
 */
export async function GET(_req: NextRequest) {
  const { userId } = await requireUser();
  const supabase = await createClient();

  // Garante que o user tá autenticado (supabase só pra sanity-check)
  if (!supabase) return NextResponse.json({ patterns: [] });

  const patterns = await listarPadroesFuturos(userId, 8);
  return NextResponse.json({ patterns });
}
