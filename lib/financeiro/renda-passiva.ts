/**
 * Cálculos puros de renda passiva (#feature renda-passiva).
 *
 * SEM dependência de next/headers — pode ser importado de componentes
 * client sem quebrar o build.
 *
 * Operações de DB em `renda-passiva-db.ts`.
 */

export interface CenarioRendaPassiva {
  id: 'conservador' | 'moderado' | 'agressivo' | 'cripto';
  label: string;
  taxa_mensal: number;
  taxa_anual: number;
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

export function calcularCapitalNecessario(
  rendaMensalDesejada: number,
  taxaMensal: number,
): number {
  if (rendaMensalDesejada <= 0 || taxaMensal <= 0) return 0;
  return rendaMensalDesejada / taxaMensal;
}

export function calcularMesesAteCapital(
  capitalAlvo: number,
  aporteMensal: number,
  taxaMensal: number,
): number | null {
  if (capitalAlvo <= 0) return 0;
  if (aporteMensal <= 0) return null;
  if (taxaMensal === 0) return Math.ceil(capitalAlvo / aporteMensal);
  const numerador = Math.log(1 + (capitalAlvo * taxaMensal) / aporteMensal);
  const denominador = Math.log(1 + taxaMensal);
  if (denominador <= 0) return null;
  return Math.ceil(numerador / denominador);
}

export function projetarValorAcumulado(
  aporteMensal: number,
  taxaMensal: number,
  meses: number,
  capitalInicial: number = 0,
): { valorFinal: number; totalAportado: number; jurosGanhos: number } {
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

// Tipo exportado pra camada DB
export interface Deposito {
  id: string;
  cenario: string;
  valor: number;
  descricao: string | null;
  occurred_at: string;
}
