/**
 * Investimento nos totais financeiros.
 *
 * Investimento NÃO é lançamento (`records`) — ele fica só no módulo de
 * investimentos (Reserva de Emergência + Renda Passiva). Mas nos totais
 * por período ele conta como receita E gasto ao mesmo tempo: o saldo
 * não muda (o dinheiro saiu do caixa, mas continua sendo seu — só virou
 * investimento).
 *
 * Puro — sem DB. A leitura dos depósitos mora em `investimentos-db.ts`.
 */

export interface DepositoInvestimento {
  valor: number | string;
  occurred_at: string; // ISO do Supabase (timestamptz)
}

/** Soma os depósitos de um período. */
export function somarInvestido(depositos: DepositoInvestimento[]): number {
  return depositos.reduce((s, d) => s + Number(d.valor), 0);
}

/** Agrupa depósitos por mês 'YYYY-MM' (fuso de São Paulo). */
export function investidoPorMes(
  depositos: DepositoInvestimento[],
): Record<string, number> {
  const porMes: Record<string, number> = {};
  for (const d of depositos) {
    const mes = mesDe(d.occurred_at);
    if (!mes) continue;
    porMes[mes] = (porMes[mes] ?? 0) + Number(d.valor);
  }
  return porMes;
}

/**
 * Aplica o investimento nos totais do período: entra como receita E
 * gasto. O saldo (receitas − gastos de lançamentos) não muda.
 */
export function totaisComInvestimento(
  receitas: number,
  gastos: number,
  investido: number,
): { receitas: number; gastos: number; saldo: number } {
  return {
    receitas: receitas + investido,
    gastos: gastos + investido,
    saldo: receitas - gastos,
  };
}

/** 'YYYY-MM' no fuso de São Paulo (mesma convenção de `todayISO`). */
function mesDe(iso: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  });
  return fmt.format(new Date(iso)).slice(0, 7);
}
