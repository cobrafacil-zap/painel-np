/**
 * Cálculos puros de Reserva de Emergência (#feature reserva-emergencia).
 *
 * SEM dependência de next/headers — pode ser importado de componentes
 * client sem quebrar o build.
 *
 * Operações de DB em `reserva-emergencia-db.ts`.
 *
 * Regra de negócio:
 *   meta_reserva = gastos_fixos_mensal × 6
 *   progresso = soma_depositos / meta_reserva
 *   Quando progresso >= 1.0 → libera redirecionamento pra renda passiva.
 */

/** Mesma lógica de diluição mensal que /api/financeiro/renda-passiva usa */
export function calcularGastosFixosMensal(
  compromissos: Array<{
    valor_total: number;
    total_parcelas: number | null;
    recorrencia: string | null;
    pago: boolean;
  }>,
): number {
  let total = 0;
  for (const c of compromissos) {
    if (c.pago) continue;
    const valorTotal = Number(c.valor_total);
    const totalParc = Number(c.total_parcelas ?? 1);
    if (totalParc <= 1) {
      total += valorTotal;
    } else if (c.recorrencia === 'mensal') {
      total += valorTotal / totalParc;
    } else if (c.recorrencia === 'semanal') {
      total += (valorTotal / totalParc) * 4;
    } else if (c.recorrencia === 'anual') {
      total += valorTotal / 12;
    }
  }
  return Math.round(total * 100) / 100;
}

/** Multiplicador padrão de meses de cobertura */
export const MULTIPLICADOR_MESES = 6;

/** Calcula a meta da reserva (gastos fixos × multiplicador) */
export function calcularMetaReserva(gastosFixosMensal: number): number {
  return Math.round(gastosFixosMensal * MULTIPLICADOR_MESES * 100) / 100;
}

export interface ProgressoReserva {
  meta: number;
  total_depositado: number;
  /** 0..1+ (pode passar de 100% se user depositou além) */
  progresso_pct: number;
  /** true quando progresso_pct >= 1.0 */
  completa: boolean;
  /** quanto falta pra bater a meta (0 se já bateu) */
  falta: number;
  /** quantos meses faltam se mantiver o aporte mensal (Infinity se aporte=0) */
  meses_estimados: number | null;
}

/** Calcula o progresso de um user */
export function calcularProgresso(
  gastosFixosMensal: number,
  totalDepositado: number,
  aporteMensalDesejado: number = 0,
): ProgressoReserva {
  const meta = calcularMetaReserva(gastosFixosMensal);
  const pct = meta > 0 ? totalDepositado / meta : 0;
  const falta = Math.max(0, meta - totalDepositado);
  const mesesEstimados =
    aporteMensalDesejado > 0 && falta > 0
      ? Math.ceil(falta / aporteMensalDesejado)
      : null;

  return {
    meta,
    total_depositado: Math.round(totalDepositado * 100) / 100,
    progresso_pct: Math.min(pct, 999) / 1, // deixa passar de 100% visualmente
    completa: pct >= 1.0,
    falta: Math.round(falta * 100) / 100,
    meses_estimados: mesesEstimados,
  };
}

/** Sugestão textual de onde guardar (decisão com user: sem número mágico) */
export const ONDE_GUARDAR_SUGESTOES = [
  {
    titulo: 'Tesouro Selic',
    descricao: 'Título público do governo federal, liquidez diária (resgate em D+1). Cobertura do FGC até R$ 250k por tipo.',
    badge: 'Mais seguro',
  },
  {
    titulo: 'CDB liquidez diária',
    descricao: 'De bancos grandes (Itaú, Bradesco, Nubank, Inter). Cobertura do FGC até R$ 250k por CPF/instituição.',
    badge: 'Praticidade',
  },
  {
    titulo: 'Conta remunerada',
    descricao: 'Nubank, Inter, C6. Rendem ~100% do CDI todo dia, sem precisar aplicar.',
    badge: 'Zero atrito',
  },
];
