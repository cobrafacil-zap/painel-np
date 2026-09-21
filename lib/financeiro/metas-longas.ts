/**
 * Metas financeiras de longo prazo (#overhaul metas-largas).
 *
 * O user define N metas tipo "juntar 100k pra casa em 5 anos" e o
 * sistema calcula quanto precisa guardar/mês, se tá no prazo, e
 * projeta quando atinge.
 *
 * Valor guardado é MANUAL — o user fala "já juntei 30k" de vez em
 * quando. Não tentamos adivinhar investimentos externos.
 */

import { createServiceClient } from '@/lib/supabase/server';

export interface MetaLonga {
  id: string;
  nome: string;
  valor_alvo: number;
  prazo_meses: number;
  valor_guardado: number;
  ativa: boolean;
  created_at: string;
  updated_at: string;
}

export interface MetaLongaComProgresso extends MetaLonga {
  /** % entre 0 e 100 (ou >100 se estourou) */
  progresso_pct: number;
  /** Falta quanto pra bater */
  falta: number;
  /** Meses restantes até o prazo */
  meses_restantes: number;
  /** Quanto precisa guardar por mês pra bater no prazo */
  parcela_mensal: number;
  /** "no_prazo" | "atrasado" | "concluida" */
  status: 'no_prazo' | 'atrasado' | 'concluida';
}

/**
 * Lista metas ativas do user com progresso calculado.
 */
export async function listMetasLongas(userId: string): Promise<MetaLongaComProgresso[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('metas_longas')
    .select('*')
    .eq('user_id', userId)
    .eq('ativa', true)
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  return data.map(enriquecerMeta);
}

/**
 * Calcula campos derivados: progresso, falta, parcela mensal, status.
 */
export function enriquecerMeta(meta: MetaLonga): MetaLongaComProgresso {
  const valorAlvo = Number(meta.valor_alvo);
  const valorGuardado = Number(meta.valor_guardado);
  const prazoMeses = Number(meta.prazo_meses);

  const progressoPct = valorAlvo > 0 ? (valorGuardado / valorAlvo) * 100 : 0;
  const falta = Math.max(0, valorAlvo - valorGuardado);

  // Meses desde criação até hoje
  const criada = new Date(meta.created_at);
  const hoje = new Date();
  const mesesPassados = Math.max(
    0,
    Math.floor((hoje.getTime() - criada.getTime()) / (1000 * 60 * 60 * 24 * 30.4375)),
  );
  const mesesRestantes = Math.max(0, prazoMeses - mesesPassados);

  const parcelaMensal = mesesRestantes > 0 ? falta / mesesRestantes : falta;

  let status: MetaLongaComProgresso['status'];
  if (valorGuardado >= valorAlvo) {
    status = 'concluida';
  } else if (parcelaMensal <= valorGuardado / Math.max(1, mesesPassados)) {
    // Se a parcela mensal ideal é menor ou igual ao que ele já vinha
    // guardando por mês em média, tá no prazo
    status = 'no_prazo';
  } else {
    status = 'atrasado';
  }

  return {
    ...meta,
    progresso_pct: progressoPct,
    falta,
    meses_restantes: mesesRestantes,
    parcela_mensal: parcelaMensal,
    status,
  };
}

/**
 * Cria ou substitui meta do user (idempotente por nome).
 * Se já existe meta com mesmo nome pra esse user, atualiza em vez de duplicar.
 */
export async function upsertMetaLonga(params: {
  userId: string;
  nome: string;
  valorAlvo: number;
  prazoMeses: number;
  valorGuardado?: number;
}): Promise<MetaLonga | null> {
  const supabase = createServiceClient();
  // Procura meta ativa com mesmo nome
  const { data: existing } = await supabase
    .from('metas_longas')
    .select('id')
    .eq('user_id', params.userId)
    .eq('nome', params.nome)
    .eq('ativa', true)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from('metas_longas')
      .update({
        valor_alvo: params.valorAlvo,
        prazo_meses: params.prazoMeses,
        ...(params.valorGuardado != null ? { valor_guardado: params.valorGuardado } : {}),
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) return null;
    return data as MetaLonga;
  }

  const { data, error } = await supabase
    .from('metas_longas')
    .insert({
      user_id: params.userId,
      nome: params.nome,
      valor_alvo: params.valorAlvo,
      prazo_meses: params.prazoMeses,
      valor_guardado: params.valorGuardado ?? 0,
      ativa: true,
    })
    .select('*')
    .single();

  if (error) return null;
  return data as MetaLonga;
}

/**
 * Atualiza valor guardado (chamado quando user fala "já juntei 30k").
 */
export async function atualizarValorGuardado(
  metaId: string,
  novoValor: number,
): Promise<boolean> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from('metas_longas')
    .update({ valor_guardado: Math.max(0, novoValor) })
    .eq('id', metaId);
  return !error;
}

/**
 * "Desativa" meta (soft delete — mantém histórico).
 */
export async function desativarMetaLonga(metaId: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from('metas_longas')
    .update({ ativa: false })
    .eq('id', metaId);
  return !error;
}

/**
 * Simula: dado valor alvo + prazo, retorna quanto precisa guardar/mês.
 * Não persiste — só calcula.
 */
export function simularMetaLonga(valorAlvo: number, prazoMeses: number): {
  parcela_mensal: number;
  total_anos: number;
} {
  return {
    parcela_mensal: prazoMeses > 0 ? valorAlvo / prazoMeses : valorAlvo,
    total_anos: prazoMeses / 12,
  };
}
