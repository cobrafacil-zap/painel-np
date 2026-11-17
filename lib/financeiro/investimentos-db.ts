/**
 * Leitura dos depósitos de investimento (Reserva de Emergência + Renda
 * Passiva) pra compor os totais financeiros por período — ver regra em
 * `investimentos.ts` (entra como receita E gasto, sem virar lançamento).
 *
 * DEPENDE de next/headers — só pode ser importado de rotas API / server
 * components (mesmo padrão de `renda-passiva-db.ts`).
 */

import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import {
  somarInvestido,
  investidoPorMes,
  type DepositoInvestimento,
} from './investimentos';

const TABELAS_INVESTIMENTO = [
  'depositos_reserva_emergencia',
  'depositos_renda_passiva',
] as const;

async function buscarDepositos(
  userId: string,
  from?: string,
  to?: string,
): Promise<DepositoInvestimento[]> {
  const supabase = createServiceClient();
  const queries = TABELAS_INVESTIMENTO.map((tabela) => {
    let q = supabase
      .from(tabela)
      .select('valor, occurred_at')
      .eq('user_id', userId);
    // occurred_at é timestamptz — limites no fuso de São Paulo (UTC-3,
    // mesma convenção de `todayISO`).
    if (from) q = q.gte('occurred_at', `${from}T00:00:00-03:00`);
    if (to) q = q.lte('occurred_at', `${to}T23:59:59.999-03:00`);
    return q;
  });
  const resultados = await Promise.all(queries);
  return resultados.flatMap((r) => (r.data ?? []) as DepositoInvestimento[]);
}

/** Total investido no período (Reserva + Renda Passiva). */
export async function getInvestidoPeriodo(
  userId: string,
  from?: string,
  to?: string,
): Promise<number> {
  return somarInvestido(await buscarDepositos(userId, from, to));
}

/** Quanto foi investido em cada mês 'YYYY-MM' do período. */
export async function getInvestidoPorMes(
  userId: string,
  from?: string,
  to?: string,
): Promise<Record<string, number>> {
  return investidoPorMes(await buscarDepositos(userId, from, to));
}
