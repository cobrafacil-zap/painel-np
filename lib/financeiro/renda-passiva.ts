/**
 * Cálculos de renda passiva (#feature renda-passiva).
 *
 * 4 cenários com taxa real líquida a.m. conservadora:
 *   - Conservador (Tesouro Selic / CDB liquidez): 0,5% a.m. (~6,2% a.a.)
 *   - Moderado (FIIs + alguns dividendos): 1,0% a.m. (~12,7% a.a.)
 *   - Agressivo (carteira de dividendos bem montada): 1,5% a.m. (~19,6% a.a.)
 *   - Cripto (stake de blue chips, mais volátil): 3,0% a.m. (~42% a.a.)
 *
 * Conceito: "capital necessário HOJE" = renda_desejada / taxa_mensal.
 *   Ex: 700/mês ÷ 0,001 (0,1%) = R$ 700.000 (exemplo do user).
 *   Ex: 700/mês ÷ 0,01 (1%) = R$ 70.000.
 *
 * Conceito 2: "tempo até atingir" = FV de série com aportes. Dado aporte
 * mensal e taxa, quanto tempo leva pra acumular o capital necessário?
 *
 *   FV = PMT × [((1 + i)^n - 1) / i]
 *   isolando n: n = log(1 + FV*i/PMT) / log(1 + i)
 */

export interface CenarioRendaPassiva {
  id: 'conservador' | 'moderado' | 'agressivo' | 'cripto';
  label: string;
  taxa_mensal: number; // ex: 0.01 = 1% a.m.
  taxa_anual: number; // ex: 0.127 ≈ 12.7% a.a.
  descricao: string;
}

export const CENARIOS: CenarioRendaPassiva[] = [
  {
    id: 'conservador',
    label: 'Conservador',
    taxa_mensal: 0.005,
    taxa_anual: 0.0617,
    descricao: 'Tesouro Selic, CDB liquidez diária. Risco baixo.',
  },
  {
    id: 'moderado',
    label: 'Moderado',
    taxa_mensal: 0.01,
    taxa_anual: 0.1268,
    descricao: 'FIIs, alguns dividendos. Risco médio.',
  },
  {
    id: 'agressivo',
    label: 'Agressivo',
    taxa_mensal: 0.015,
    taxa_anual: 0.1956,
    descricao: 'Carteira de dividendos bem montada. Risco médio-alto.',
  },
  {
    id: 'cripto',
    label: 'Cripto',
    taxa_mensal: 0.03,
    taxa_anual: 0.4258,
    descricao: 'Staking de blue chips. Volátil — não é dinheiro garantido.',
  },
];

/**
 * Capital necessário HOJE pra gerar renda_desejada com a taxa.
 * Fórmula: capital = renda / taxa
 *
 * @param rendaMensalDesejada renda mensal desejada em R$
 * @param taxaMensal taxa em decimal (0.01 = 1% a.m.)
 */
export function calcularCapitalNecessario(
  rendaMensalDesejada: number,
  taxaMensal: number,
): number {
  if (rendaMensalDesejada <= 0 || taxaMensal <= 0) return 0;
  return rendaMensalDesejada / taxaMensal;
}

/**
 * Calcula em quantos meses o capital_alvo é atingido dado aporte mensal.
 * Usa FV de série: FV = PMT × [((1 + i)^n - 1) / i]
 * Isolando n: n = log(1 + FV*i/PMT) / log(1 + i)
 *
 * Retorna null se aporte for zero (sem aporte, só juro sobre 0 inicial → nunca).
 * Retorna Infinity se taxa=0 (sem rendimento, aporte linear).
 * Retorna 0 se FV <= 0.
 */
export function calcularMesesAteCapital(
  capitalAlvo: number,
  aporteMensal: number,
  taxaMensal: number,
): number | null {
  if (capitalAlvo <= 0) return 0;
  if (aporteMensal <= 0) return null; // sem aporte, nunca atinge (a menos que já tenha)
  if (taxaMensal === 0) {
    return Math.ceil(capitalAlvo / aporteMensal);
  }
  // n = ln(1 + FV*i/PMT) / ln(1 + i)
  const numerador = Math.log(1 + (capitalAlvo * taxaMensal) / aporteMensal);
  const denominador = Math.log(1 + taxaMensal);
  if (denominador <= 0) return null;
  return Math.ceil(numerador / denominador);
}

/**
 * Projeta valor acumulado em N meses dado aporte + taxa.
 */
export function projetarValorAcumulado(
  aporteMensal: number,
  taxaMensal: number,
  meses: number,
  capitalInicial: number = 0,
): {
  valorFinal: number;
  totalAportado: number;
  jurosGanhos: number;
} {
  if (meses <= 0) {
    return { valorFinal: capitalInicial, totalAportado: 0, jurosGanhos: 0 };
  }
  const fvCapitalInicial = capitalInicial * Math.pow(1 + taxaMensal, meses);
  const fvSerie =
    taxaMensal === 0
      ? aporteMensal * meses
      : (aporteMensal * (Math.pow(1 + taxaMensal, meses) - 1)) / taxaMensal;
  const valorFinal = fvCapitalInicial + fvSerie;
  const totalAportado = aporteMensal * meses + capitalInicial;
  return {
    valorFinal,
    totalAportado,
    jurosGanhos: valorFinal - totalAportado,
  };
}

export interface LinhaCenario {
  cenario: CenarioRendaPassiva;
  capital_necessario: number;
  meses_ate_atingir: number | null;
  anos_ate_atingir: number | null;
}

/**
 * Calcula todas as 4 linhas de cenário dado renda e aporte.
 */
export function simularRendaPassiva(params: {
  rendaMensalDesejada: number;
  aporteMensal: number;
}): LinhaCenario[] {
  const { rendaMensalDesejada, aporteMensal } = params;

  return CENARIOS.map((c) => {
    const capitalNecessario = calcularCapitalNecessario(rendaMensalDesejada, c.taxa_mensal);
    const meses = calcularMesesAteCapital(capitalNecessario, aporteMensal, c.taxa_mensal);
    return {
      cenario: c,
      capital_necessario: capitalNecessario,
      meses_ate_atingir: meses,
      anos_ate_atingir: meses != null ? Math.round((meses / 12) * 10) / 10 : null,
    };
  });
}

/**
 * Formata meses em texto PT-BR legível.
 *   24 → "2 anos"
 *   30 → "2 anos e 6 meses"
 */
export function formatarPrazo(meses: number | null): string {
  if (meses == null) return '— (aporte zerado)';
  if (meses === 0) return 'hoje';
  const anos = Math.floor(meses / 12);
  const mesesRestantes = meses % 12;
  if (anos === 0) return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  if (mesesRestantes === 0) return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
  return `${anos} ${anos === 1 ? 'ano' : 'anos'} e ${mesesRestantes} ${
    mesesRestantes === 1 ? 'mês' : 'meses'
  }`;
}
