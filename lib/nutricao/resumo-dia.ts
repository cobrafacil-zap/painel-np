/**
 * Resumo nutricional do dia (#feature alimentação).
 *
 * Soma macros de todas as refeições ATIVAS de hoje, compara com meta.
 * Retorna histórico semanal pra card de cuidado pessoal.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { getMetasNutricao, type MetasNutricao } from './metas';
import { todayISO } from '@/lib/utils';
import { listRefeicoes } from '@/lib/food-photo-storage';

export interface ResumoDia {
  data: string; // YYYY-MM-DD
  consumido: {
    kcal: number;
    protein_g: number;
    carb_g: number;
    fat_g: number;
    refeicoes_count: number;
  };
  meta: MetasNutricao | null;
  progresso: {
    kcal_pct: number;
    protein_pct: number;
    carb_pct: number;
    fat_pct: number;
  };
  refeicoes: Array<{
    id: string;
    occurred_at: string;
    meal_type: string | null;
    kcal: number | null;
    itens: Array<{ nome: string; gramas: number; kcal: number }>;
    signed_url: string | null;
  }>;
}

export async function getResumoHoje(userId: string): Promise<ResumoDia> {
  const supabase = createServiceClient();
  const hoje = todayISO();
  const meta = await getMetasNutricao(userId);

  // Soma direta via SQL agregado (evita carregar todas as refeições pra somar em JS)
  const { data: somas } = await supabase
    .from('refeicoes')
    .select('kcal, protein_g, carb_g, fat_g')
    .eq('user_id', userId)
    .eq('ativa', true)
    .gte('occurred_at', `${hoje}T00:00:00Z`)
    .lt('occurred_at', `${hoje}T23:59:59Z`);

  const consumido = {
    kcal: 0,
    protein_g: 0,
    carb_g: 0,
    fat_g: 0,
    refeicoes_count: somas?.length ?? 0,
  };
  for (const r of somas ?? []) {
    consumido.kcal += Number(r.kcal) || 0;
    consumido.protein_g += Number(r.protein_g) || 0;
    consumido.carb_g += Number(r.carb_g) || 0;
    consumido.fat_g += Number(r.fat_g) || 0;
  }

  const pct = (consumido: number, meta: number | null) =>
    meta && meta > 0 ? Math.round((consumido / meta) * 100) : 0;

  const progresso = {
    kcal_pct: pct(consumido.kcal, meta.meta_kcal),
    protein_pct: pct(consumido.protein_g, meta.meta_protein_g),
    carb_pct: pct(consumido.carb_g, meta.meta_carb_g),
    fat_pct: pct(consumido.fat_g, meta.meta_fat_g),
  };

  // Lista as refeições do dia com signed URL
  const { items: refeicoes } = await listRefeicoes({
    userId,
    limit: 10,
    offset: 0,
  });
  const refeicoesHoje = refeicoes
    .filter((r) => r.occurred_at.startsWith(hoje))
    .map((r) => ({
      id: r.id,
      occurred_at: r.occurred_at,
      meal_type: r.meal_type,
      kcal: r.kcal,
      itens: r.itens.map((it) => ({ nome: it.nome, gramas: it.gramas, kcal: it.kcal })),
      signed_url: r.signed_url,
    }));

  return {
    data: hoje,
    consumido,
    meta,
    progresso,
    refeicoes: refeicoesHoje,
  };
}

export interface ResumoSemana {
  dias: Array<{
    data: string; // YYYY-MM-DD
    label: string; // 'Seg', 'Ter'...
    kcal: number;
    protein_g: number;
    refeicoes_count: number;
  }>;
  media: {
    kcal: number;
    protein_g: number;
  };
}

export async function getResumoSemana(userId: string): Promise<ResumoSemana> {
  const supabase = createServiceClient();
  const seteDiasAtras = new Date();
  seteDiasAtras.setDate(seteDiasAtras.getDate() - 6); // 7 dias incluindo hoje

  const inicio = seteDiasAtras.toISOString().slice(0, 10);
  const fim = todayISO();

  const { data: rows } = await supabase
    .from('refeicoes')
    .select('kcal, protein_g, occurred_at')
    .eq('user_id', userId)
    .eq('ativa', true)
    .gte('occurred_at', `${inicio}T00:00:00Z`)
    .lte('occurred_at', `${fim}T23:59:59Z`);

  const porDia = new Map<string, { kcal: number; protein_g: number; refeicoes: number }>();
  for (const r of rows ?? []) {
    const dia = (r.occurred_at as string).slice(0, 10);
    const cur = porDia.get(dia) ?? { kcal: 0, protein_g: 0, refeicoes: 0 };
    cur.kcal += Number(r.kcal) || 0;
    cur.protein_g += Number(r.protein_g) || 0;
    cur.refeicoes += 1;
    porDia.set(dia, cur);
  }

  // Preenche todos os 7 dias (mesmo sem refeição)
  const dias: ResumoSemana['dias'] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const cur = porDia.get(iso) ?? { kcal: 0, protein_g: 0, refeicoes: 0 };
    dias.push({
      data: iso,
      label: d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''),
      kcal: cur.kcal,
      protein_g: cur.protein_g,
      refeicoes_count: cur.refeicoes,
    });
  }

  const diasComRefeicao = dias.filter((d) => d.refeicoes_count > 0);
  const media = {
    kcal: diasComRefeicao.length > 0
      ? Math.round(diasComRefeicao.reduce((s, d) => s + d.kcal, 0) / diasComRefeicao.length)
      : 0,
    protein_g: diasComRefeicao.length > 0
      ? Math.round(diasComRefeicao.reduce((s, d) => s + d.protein_g, 0) / diasComRefeicao.length)
      : 0,
  };

  return { dias, media };
}
