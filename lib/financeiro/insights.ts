/**
 * Gerador de dicas/insights financeiros personalizados (#overhaul metas-largas).
 *
 * Olha os dados reais do user (últimos 7 dias) e retorna 1-3 frases
 * naturais com:
 *   - padrão identificado (gastos subiram em X categoria)
 *   - aderência à meta diária
 *   - progresso das metas longas
 *   - 1 ação concreta sugerida
 *
 * Sem LLM por enquanto — lógica determinística baseada em diffs,
 * thresholds e templates. Mais barato, mais previsível, zero risco
 * de alucinação.
 *
 * Retorna `null` se não tiver dados suficientes pra insight útil.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { getMetaDiaria, getGastoHoje } from './meta-diaria';
import { listMetasLongas } from './metas-longas';
import { formatBRL } from '@/lib/utils';

export interface Insight {
  /** Frase curta — ex: "Gastos com delivery subiram 40% essa semana" */
  titulo: string;
  /** Contexto + ação sugerida */
  descricao: string;
  /** Tag pra agrupar no painel */
  tipo: 'padrao' | 'meta_diaria' | 'meta_longa' | 'saldo' | 'economia';
}

interface Semana {
  /** Map<categoria, total> dos últimos 7 dias */
  semanaAtual: Map<string, number>;
  /** Map<categoria, total> dos 7 dias anteriores (pra comparar) */
  semanaAnterior: Map<string, number>;
  totalGasto: number;
  totalReceita: number;
}

async function carregarSemanas(userId: string): Promise<Semana | null> {
  const supabase = createServiceClient();
  const hoje = new Date();
  const seteDiasAtras = new Date();
  seteDiasAtras.setDate(hoje.getDate() - 7);
  const catorceDiasAtras = new Date();
  catorceDiasAtras.setDate(hoje.getDate() - 14);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const ini = fmt(catorceDiasAtras);
  const fim = fmt(hoje);

  const { data: records } = await supabase
    .from('records')
    .select('type, amount, category, occurred_at')
    .eq('user_id', userId)
    .eq('module_id', 'financeiro')
    .gte('occurred_at', ini)
    .lte('occurred_at', fim);

  if (!records || records.length === 0) return null;

  const semanaAtual = new Map<string, number>();
  const semanaAnterior = new Map<string, number>();
  const cutoff = seteDiasAtras.toISOString().slice(0, 10);
  let totalGasto = 0;
  let totalReceita = 0;

  for (const r of records) {
    const amt = Number(r.amount);
    if (r.type === 'receita') {
      totalReceita += amt;
      continue;
    }
    if (r.type !== 'gasto') continue;
    const cat = (r.category ?? 'outros') as string;
    const map = r.occurred_at >= cutoff ? semanaAtual : semanaAnterior;
    map.set(cat, (map.get(cat) ?? 0) + amt);
    if (r.occurred_at >= cutoff) totalGasto += amt;
  }

  return { semanaAtual, semanaAnterior, totalGasto, totalReceita };
}

/**
 * Gera lista de insights (1-3 itens) baseado nos dados do user.
 * Retorna array vazio se não houver dados suficientes.
 */
export async function gerarInsights(userId: string): Promise<Insight[]> {
  const insights: Insight[] = [];
  const semanas = await carregarSemanas(userId);
  const metaDiaria = await getMetaDiaria(userId);
  const gastoHoje = await getGastoHoje(userId);
  const metasLongas = await listMetasLongas(userId);

  // === 1. Categoria que mais subiu (se >30% de aumento e >R$50 absolutos) ===
  if (semanas) {
    let piorDelta = 0;
    let piorCat: { nome: string; atual: number; anterior: number } | null = null;
    for (const [cat, atual] of semanas.semanaAtual) {
      const anterior = semanas.semanaAnterior.get(cat) ?? 0;
      if (anterior === 0) continue;
      const deltaPct = ((atual - anterior) / anterior) * 100;
      const deltaAbs = atual - anterior;
      if (deltaPct > piorDelta && deltaPct >= 30 && deltaAbs >= 50) {
        piorDelta = deltaPct;
        piorCat = { nome: cat, atual, anterior };
      }
    }
    if (piorCat) {
      insights.push({
        tipo: 'padrao',
        titulo: `${piorCat.nome} subiu ${piorDelta.toFixed(0)}% essa semana`,
        descricao: `Você gastou ${formatBRL(piorCat.atual)} com ${piorCat.nome} nos últimos 7 dias, contra ${formatBRL(piorCat.anterior)} na semana anterior. Vale definir limite? Fala "meta de X pra ${piorCat.nome}".`,
      });
    }
  }

  // === 2. Meta diária estourada (se >100%) ===
  if (metaDiaria && gastoHoje && gastoHoje > metaDiaria) {
    const excesso = gastoHoje - metaDiaria;
    insights.push({
      tipo: 'meta_diaria',
      titulo: `🔴 Meta diária estourada`,
      descricao: `Já gastou ${formatBRL(gastoHoje)} hoje, ${formatBRL(excesso)} acima da meta de ${formatBRL(metaDiaria)}. Amanhã tenta compensar?`,
    });
  } else if (metaDiaria && gastoHoje && gastoHoje > metaDiaria * 0.8) {
    insights.push({
      tipo: 'meta_diaria',
      titulo: `🟡 Atenção à meta diária`,
      descricao: `Já gastou ${formatBRL(gastoHoje)} (${((gastoHoje / metaDiaria) * 100).toFixed(0)}% da meta diária de ${formatBRL(metaDiaria)}).`,
    });
  }

  // === 3. Meta longa atrasada (pega a primeira atrasada) ===
  const atrasada = metasLongas.find((m) => m.status === 'atrasado');
  if (atrasada) {
    insights.push({
      tipo: 'meta_longa',
      titulo: `${atrasada.nome} tá atrasada`,
      descricao: `Pra bater ${formatBRL(atrasada.valor_alvo)} em ${atrasada.prazo_meses} meses, precisa guardar ${formatBRL(atrasada.parcela_mensal)}/mês. Tá guardando menos que isso. Quer aumentar o ritmo?`,
    });
  } else {
    const proximaPraConcluir = metasLongas.find((m) => m.status === 'no_prazo' && m.progresso_pct >= 50);
    if (proximaPraConcluir) {
      insights.push({
        tipo: 'meta_longa',
        titulo: `${proximaPraConcluir.nome} na metade do caminho`,
        descricao: `${proximaPraConcluir.progresso_pct.toFixed(0)}% alcançado (${formatBRL(proximaPraConcluir.valor_guardado)} de ${formatBRL(proximaPraConcluir.valor_alvo)}). Continua no ritmo.`,
      });
    }
  }

  // === 4. Saldo do mês negativo (se user tem receitas E fechou negativo na semana) ===
  if (semanas && semanas.totalReceita > 0 && semanas.totalGasto > semanas.totalReceita * 1.3) {
    insights.push({
      tipo: 'saldo',
      titulo: `Gastos > receitas essa semana`,
      descricao: `Entrou ${formatBRL(semanas.totalReceita)} e saiu ${formatBRL(semanas.totalGasto)}. Tá no vermelho ${formatBRL(semanas.totalGasto - semanas.totalReceita)}. Vale revisar categoria principal?`,
    });
  }

  // Limita a 3 — painel mostra os 3 mais relevantes
  return insights.slice(0, 3);
}

/**
 * Versão resumida — 1 frase só pra embutir no relatório diário do WhatsApp.
 * Pega o insight mais urgente (prioridade: meta_longa atrasada > meta_diaria
 * estourada > padrão > saldo).
 */
export async function gerarInsightCurto(userId: string): Promise<string | null> {
  const insights = await gerarInsights(userId);
  if (insights.length === 0) return null;
  const prioridade = ['meta_longa', 'meta_diaria', 'padrao', 'saldo'];
  const sorted = [...insights].sort((a, b) => prioridade.indexOf(a.tipo) - prioridade.indexOf(b.tipo));
  return sorted[0].descricao.split('.')[0] + '.'; // pega só a 1ª frase
}
