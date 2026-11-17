/**
 * Operações de DB do ledger de investimentos (`depositos_investimento`),
 * organizado por categoria: reserva | imobiliario | acoes.
 *
 * Investimento NÃO é lançamento (`records`) — fica só aqui. Mas conta
 * nos totais financeiros como receita E gasto (ver `investimentos.ts`).
 *
 * DEPENDE de next/headers — só pode ser importado de rotas API / server
 * components (mesmo padrão de `renda-passiva-db.ts`).
 */

import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import {
  somarInvestido,
  investidoPorMes,
  type CategoriaInvestimento,
  type DepositoInvestimento,
} from './investimentos';

export interface DepositoInvestimentoRow extends DepositoInvestimento {
  id: string;
  categoria: CategoriaInvestimento;
  descricao: string | null;
}

const TABELA = 'depositos_investimento';

async function buscarDepositos(
  userId: string,
  from?: string,
  to?: string,
): Promise<DepositoInvestimentoRow[]> {
  const supabase = createServiceClient();
  let q = supabase
    .from(TABELA)
    .select('id, categoria, valor, descricao, occurred_at')
    .eq('user_id', userId);
  // occurred_at é timestamptz — limites no fuso de São Paulo (UTC-3,
  // mesma convenção de `todayISO`).
  if (from) q = q.gte('occurred_at', `${from}T00:00:00-03:00`);
  if (to) q = q.lte('occurred_at', `${to}T23:59:59.999-03:00`);
  const { data } = await q;
  return (data ?? []) as DepositoInvestimentoRow[];
}

/** Total investido no período (todas as categorias). */
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

/** Total investido por categoria (histórico todo). */
export async function getTotaisPorCategoria(
  userId: string,
): Promise<Record<CategoriaInvestimento, number>> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from(TABELA)
    .select('categoria, valor')
    .eq('user_id', userId);
  const totais: Record<CategoriaInvestimento, number> = {
    reserva: 0,
    imobiliario: 0,
    acoes: 0,
  };
  for (const r of (data ?? []) as Array<{ categoria: CategoriaInvestimento; valor: number | string }>) {
    totais[r.categoria] += Number(r.valor);
  }
  return totais;
}

/** Últimos aportes (mais recentes primeiro). */
export async function listarDepositos(
  userId: string,
  limit: number = 100,
): Promise<DepositoInvestimentoRow[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from(TABELA)
    .select('id, categoria, valor, descricao, occurred_at')
    .eq('user_id', userId)
    .order('occurred_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as DepositoInvestimentoRow[];
}

export async function registrarDeposito(params: {
  userId: string;
  categoria: CategoriaInvestimento;
  valor: number;
  descricao?: string | null;
}): Promise<DepositoInvestimentoRow | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from(TABELA)
    .insert({
      user_id: params.userId,
      categoria: params.categoria,
      valor: params.valor,
      descricao: params.descricao ?? null,
    })
    .select('id, categoria, valor, descricao, occurred_at')
    .single();
  if (error || !data) return null;
  return data as DepositoInvestimentoRow;
}

export async function removerDeposito(
  userId: string,
  depositoId: string,
): Promise<boolean> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from(TABELA)
    .delete()
    .eq('id', depositoId)
    .eq('user_id', userId);
  return !error;
}
