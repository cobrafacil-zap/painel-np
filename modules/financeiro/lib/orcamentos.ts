/**
 * Operações de orçamento/meta (#10) chamadas pelo webhook WhatsApp.
 *
 * Wrappers em volta da rota `/api/financeiro/orcamentos` que:
 * - set: UPSERT em budgets(category_slug, period=YYYY-MM, amount)
 * - get: SELECT + soma de gastos no período pra mostrar progresso
 * - delete: DELETE
 *
 * Usa service client direto (mesmo padrão de acoes.ts/consultas.ts).
 */

import { createServiceClient } from '@/lib/supabase/server';
import { formatBRL, monthISO } from '@/lib/utils';

export type OrcamentoResult = {
  reply: string;
  ok: boolean;
};

function mesAtual(): string {
  return monthISO();
}

function startEndDoMes(period: string): { from: string; to: string } {
  const [ano, mes] = period.split('-').map(Number);
  const from = `${ano}-${String(mes).padStart(2, '0')}-01`;
  // último dia do mês: dia 0 do próximo mês
  const lastDay = new Date(ano, mes, 0).getDate();
  const to = `${ano}-${String(mes).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

export async function setOrcamento(
  userId: string,
  categoria: string,
  amount: number
): Promise<OrcamentoResult> {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { reply: `🤔 Valor inválido pra meta.`, ok: false };
  }
  const supabase = createServiceClient();
  const period = mesAtual();
  const { data, error } = await supabase
    .from('budgets')
    .upsert(
      { user_id: userId, category_slug: categoria, period, amount },
      { onConflict: 'user_id,category_slug,period' }
    )
    .select()
    .single();
  if (error) {
    return { reply: `⚠️ Erro ao salvar meta: ${error.message}`, ok: false };
  }
  return {
    reply: `✅ Meta de "${categoria}" definida: ${formatBRL(amount)}/mês (${period}).`,
    ok: true,
  };
}

export async function getOrcamento(
  userId: string,
  categoria: string
): Promise<OrcamentoResult> {
  const supabase = createServiceClient();
  const period = mesAtual();
  const { data: budget } = await supabase
    .from('budgets')
    .select('amount')
    .eq('user_id', userId)
    .eq('category_slug', categoria)
    .eq('period', period)
    .maybeSingle();

  if (!budget) {
    return {
      reply: `🤷 Nenhuma meta definida pra "${categoria}" em ${period}.\nManda "definir meta de X pra ${categoria}" pra criar.`,
      ok: false,
    };
  }

  // Calcula gasto atual no mês nessa categoria
  const { from, to } = startEndDoMes(period);
  const { data: rows } = await supabase
    .from('records')
    .select('amount')
    .eq('user_id', userId)
    .eq('module_id', 'financeiro')
    .eq('type', 'gasto')
    .eq('category', categoria)
    .gte('occurred_at', from)
    .lte('occurred_at', to);

  const gastoAtual = (rows ?? []).reduce((s, r) => s + Number(r.amount), 0);
  const meta = Number(budget.amount);
  const restante = meta - gastoAtual;
  const pct = meta > 0 ? Math.round((gastoAtual / meta) * 100) : 0;

  let status = '';
  if (gastoAtual > meta) {
    status = `\n🔴 Estourou em ${formatBRL(gastoAtual - meta)}!`;
  } else if (pct >= 80) {
    status = `\n🟡 Tá apertado, falta ${formatBRL(restante)}.`;
  } else {
    status = `\n🟢 Sobrando ${formatBRL(restante)}.`;
  }

  const barra = pct > 100 ? '█'.repeat(10) : '█'.repeat(Math.min(10, Math.floor(pct / 10))) + '░'.repeat(10 - Math.min(10, Math.floor(pct / 10)));

  return {
    reply:
      `🎯 Meta de "${categoria}" (${period}):\n` +
      `${formatBRL(meta)} — gasto até agora: ${formatBRL(gastoAtual)} (${pct}%)\n` +
      `[${barra}]${status}`,
    ok: true,
  };
}

export async function deleteOrcamento(
  userId: string,
  categoria: string
): Promise<OrcamentoResult> {
  const supabase = createServiceClient();
  const period = mesAtual();
  const { error } = await supabase
    .from('budgets')
    .delete()
    .eq('user_id', userId)
    .eq('category_slug', categoria)
    .eq('period', period);
  if (error) {
    return { reply: `⚠️ Erro ao remover meta: ${error.message}`, ok: false };
  }
  return {
    reply: `🗑️ Meta de "${categoria}" removida (${period}).`,
    ok: true,
  };
}
