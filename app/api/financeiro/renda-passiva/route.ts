/**
 * API de renda passiva (#feature renda-passiva).
 *
 * GET /api/financeiro/renda-passiva → receita média últimos 3 meses
 *   (para sugestão de aporte mensal no planejamento de renda passiva).
 */

import { NextResponse } from 'next/server';
import { createClient, requireUser } from '@/lib/supabase/server';

export async function GET() {
  const { userId } = await requireUser();
  const supabase = await createClient();

  // 90 dias atrás
  const dataInicio = new Date();
  dataInicio.setDate(dataInicio.getDate() - 90);
  const dataInicioISO = dataInicio.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('records')
    .select('type, amount, occurred_at')
    .eq('user_id', userId)
    .eq('module_id', 'financeiro')
    .eq('type', 'receita')
    .gte('occurred_at', dataInicioISO);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const receitas = (data ?? []).map((r) => Number(r.amount));
  const total = receitas.reduce((s, n) => s + n, 0);
  const mediaMensal = receitas.length > 0 ? total / 3 : 0;

  return NextResponse.json({
    receita_media_3m: Math.round(mediaMensal * 100) / 100,
    total_3m: total,
    meses_com_receita: 3,
    samples: receitas.length,
  });
}
