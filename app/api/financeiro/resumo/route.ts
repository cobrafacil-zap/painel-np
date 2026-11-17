import { NextRequest, NextResponse } from 'next/server';
import { createClient, requireUser } from '@/lib/supabase/server';
import { getInvestidoPorMes } from '@/lib/financeiro/investimentos-db';

/**
 * GET /api/financeiro/resumo?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Retorna:
 *   - saldo (receitas - gastos)
 *   - total_receitas
 *   - total_gastos
 *   - total_investido (Reserva + Renda Passiva — entra como receita E gasto)
 *   - por_categoria: [{ category, total, count }]
 *   - por_forma: [{ forma, total, count }] (gastos por tipo de pagamento)
 *   - top_por_categoria: { [category]: [{ description, total, count }] } (top 3)
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
    .select('type, amount, category, payment_method, description, occurred_at')
    .eq('user_id', userId)
    .eq('module_id', 'financeiro');

  if (from) q = q.gte('occurred_at', from);
  if (to) q = q.lte('occurred_at', to);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  let total_receitas = 0;
  let total_gastos = 0;
  const porCategoria: Record<string, { category: string | null; total: number; count: number }> = {};
  const porForma: Record<string, { forma: string | null; total: number; count: number }> = {};
  const descPorCategoria: Record<string, Record<string, { description: string; total: number; count: number }>> = {};
  const porMes: Record<string, { mes: string; receitas: number; gastos: number }> = {};

  for (const r of rows) {
    const amt = Number(r.amount);
    if (r.type === 'receita') total_receitas += amt;
    else if (r.type === 'gasto') total_gastos += amt;

    // por categoria e por tipo de pagamento (só gastos)
    if (r.type === 'gasto') {
      const keyCat = r.category ?? '';
      if (!porCategoria[keyCat]) porCategoria[keyCat] = { category: r.category ?? null, total: 0, count: 0 };
      porCategoria[keyCat].total += amt;
      porCategoria[keyCat].count += 1;

      // "coisas" (descrições) mais caras dentro de cada categoria
      const descLabel = (r.description ?? '').trim() || 'Sem descrição';
      if (!descPorCategoria[keyCat]) descPorCategoria[keyCat] = {};
      if (!descPorCategoria[keyCat][descLabel]) {
        descPorCategoria[keyCat][descLabel] = { description: descLabel, total: 0, count: 0 };
      }
      descPorCategoria[keyCat][descLabel].total += amt;
      descPorCategoria[keyCat][descLabel].count += 1;

      const keyForma = r.payment_method ?? '';
      if (!porForma[keyForma]) porForma[keyForma] = { forma: r.payment_method ?? null, total: 0, count: 0 };
      porForma[keyForma].total += amt;
      porForma[keyForma].count += 1;
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
  const por_forma = Object.values(porForma).sort((a, b) => b.total - a.total);
  const top_por_categoria: Record<
    string,
    Array<{ description: string; total: number; count: number }>
  > = {};
  for (const [cat, descs] of Object.entries(descPorCategoria)) {
    top_por_categoria[cat] = Object.values(descs)
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);
  }

  // Investimento não é lançamento, mas conta como receita E gasto
  // (saldo não muda) — ver lib/financeiro/investimentos.ts.
  const investidoPorMes = await getInvestidoPorMes(
    userId,
    from ?? undefined,
    to ?? undefined,
  );
  let total_investido = 0;
  for (const [mes, valor] of Object.entries(investidoPorMes)) {
    total_investido += valor;
    if (!porMes[mes]) porMes[mes] = { mes, receitas: 0, gastos: 0 };
    porMes[mes].receitas += valor;
    porMes[mes].gastos += valor;
  }
  total_receitas += total_investido;
  total_gastos += total_investido;

  const evolucao_mensal = Object.values(porMes).sort((a, b) => a.mes.localeCompare(b.mes));

  return NextResponse.json({
    saldo: total_receitas - total_gastos,
    total_receitas,
    total_gastos,
    total_investido,
    por_categoria,
    por_forma,
    top_por_categoria,
    evolucao_mensal,
  });
}
