/**
 * API de resumo nutricional (#feature alimentação).
 *
 * GET /api/nutricao/resumo  → resumo do dia
 * GET /api/nutricao/resumo?semana=1 → resumo dos últimos 7 dias
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getResumoHoje, getResumoSemana } from '@/lib/nutricao/resumo-dia';

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const semana = searchParams.get('semana') === '1';

  if (semana) {
    const resumo = await getResumoSemana(user.id);
    return NextResponse.json(resumo);
  }

  const resumo = await getResumoHoje(user.id);
  return NextResponse.json(resumo);
}
