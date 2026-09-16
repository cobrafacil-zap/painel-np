import { NextRequest, NextResponse } from 'next/server';
import { createClient, requireUser } from '@/lib/supabase/server';

/**
 * GET /api/financeiro/resumo?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Retorna:
 *   - saldo (receitas - gastos)
 *   - total_receitas
 *   - total_gastos
 *   - por_categoria: [{ category, total, count }]
 *   - evolucao_mensal: [{ mes: 'YYYY-MM', receitas, gastos }]
 */
export async function GET(req: NextRequest) {
  const { userId } = await requireUser();
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const supabase = await createClient();
  let q = supabase
    .from('records')
    .select('type, amount, category, occurred_at')
    .eq('user_id', userId)
    .eq('module_id', 'financeiro');

  if (from) q = q.gte('occurred_at', from);
  if (to) q = q.lte('occurred_at', to);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  let total_receitas = 0;
  let total_gastos = 0;
  const porCategoria: Record<string, { category: string; total: number; count: number }> = {};
  const porMes: Record<string, { mes: string; receitas: number; gastos: number }> = {};

  for (const r of rows) {
    const amt = Number(r.amount);
    if (r.type === 'receita') total_receitas += amt;
    else if (r.type === 'gasto') total_gastos += amt;

    // por categoria (só gastos)
    if (r.type === 'gasto' && r.category) {
      const key = r.category;
      if (!porCategoria[key]) porCategoria[key] = { category: key, total: 0, count: 0 };
      porCategoria[key].total += amt;
      porCategoria[key].count += 1;
    }

    // evolução mensal
    const mes = (r.occurred_at ?? '').slice(0, 7);
    if (mes) {
      if (!porMes[mes]) porMes[mes] = { mes, receitas: 0, gastos: 0 };
      if (r.type === 'receita') porMes[mes].receitas += amt;
      else if (r.type === 'gasto') porMes[mes].gastos += amt;
    }
  }

  const por_categoria = Object.values(porCategoria).sort((a, b) => b.total - a.total);
  const evolucao_mensal = Object.values(porMes).sort((a, b) => a.mes.localeCompare(b.mes));

  return NextResponse.json({
    saldo: total_receitas - total_gastos,
    total_receitas,
    total_gastos,
    por_categoria,
    evolucao_mensal,
  });
}
