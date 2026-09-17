/**
 * CRUD de compromissos (contas a pagar/receber, dívidas, empréstimos)
 * com suporte a parcelamento automático.
 *
 * Exemplo WhatsApp:
 *   "peguei 800 com minha mãe, pagar 200 por mês"
 *   → cria 1 compromisso de 800 + 4 parcelas mensais de 200
 */

import { createServiceClient } from '@/lib/supabase/server';
import { formatBRL } from '@/lib/utils';
import type { Compromisso, CompromissoParcela } from '@/lib/types';

export type CompromissoInput = {
  tipo: 'pagar' | 'receber';
  descricao: string;
  valor_total: number;
  data_vencimento: string | null;
  total_parcelas?: number;          // 1 = sem parcelamento
  recorrencia?: 'unica' | 'semanal' | 'mensal' | 'anual';
  observacoes?: string | null;
  source?: 'manual' | 'whatsapp' | 'importacao';
  source_message_id?: string | null;
};

export type Result = {
  reply: string;
  ok: boolean;
  id?: string;
};

export async function criarCompromisso(
  userId: string,
  input: CompromissoInput,
  messageId?: string
): Promise<Result> {
  const supabase = createServiceClient();
  const totalParcelas = input.total_parcelas ?? 1;

  // Insere o compromisso-pai
  const { data: comp, error } = await supabase
    .from('compromissos')
    .insert({
      user_id: userId,
      module_id: 'financeiro',
      tipo: input.tipo,
      descricao: input.descricao,
      valor_total: input.valor_total,
      data_vencimento: input.data_vencimento,
      observacoes: input.observacoes ?? null,
      source: input.source ?? 'whatsapp',
      source_message_id: messageId ?? input.source_message_id ?? null,
      total_parcelas: totalParcelas,
      parcela_atual: 1,
      recorrencia: totalParcelas > 1 ? input.recorrencia ?? 'mensal' : 'unica',
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505' || error.message?.toLowerCase().includes('duplicate')) {
      return { reply: 'ℹ️ Esse lembrete já tinha sido registrado.', ok: false };
    }
    return { reply: `⚠️ Erro ao salvar: ${error.message}`, ok: false };
  }

  const c = comp as Compromisso;

  // Se tem parcelas, gera as linhas de parcela
  if (totalParcelas > 1) {
    const valorParcela = input.valor_total / totalParcelas;
    const parcelas = [];
    for (let i = 0; i < totalParcelas; i++) {
      const venc = calcularProximaParcela(input.data_vencimento, i, c.recorrencia);
      parcelas.push({
        compromisso_id: c.id,
        user_id: userId,
        numero: i + 1,
        valor: Math.round(valorParcela * 100) / 100,
        data_vencimento: venc,
      });
    }
    // Ajusta a última parcela pra fechar o valor (pode ter diferença de arredondamento)
    const somaParcial = parcelas.slice(0, -1).reduce((acc, p) => acc + p.valor, 0);
    parcelas[parcelas.length - 1].valor =
      Math.round((input.valor_total - somaParcial) * 100) / 100;

    const { error: parcErr } = await supabase
      .from('compromisso_parcelas')
      .insert(parcelas);

    if (parcErr) {
      return {
        reply: `⚠️ Compromisso criado mas parcelas falharam: ${parcErr.message}`,
        ok: false,
        id: c.id,
      };
    }
  }

  return {
    reply: formatarConfirmacao(c, totalParcelas, input.valor_total / totalParcelas),
    ok: true,
    id: c.id,
  };
}

function calcularProximaParcela(
  dataBase: string | null,
  indice: number,
  recorrencia: 'unica' | 'semanal' | 'mensal' | 'anual'
): string {
  const base = dataBase ? new Date(dataBase + 'T00:00:00') : new Date();
  let data = new Date(base);
  if (indice > 0) {
    if (recorrencia === 'semanal') data.setDate(data.getDate() + 7 * indice);
    else if (recorrencia === 'anual') data.setFullYear(data.getFullYear() + indice);
    else if (recorrencia === 'mensal') data.setMonth(data.getMonth() + indice);
  }
  return data.toISOString().slice(0, 10);
}

function formatarConfirmacao(
  c: Compromisso,
  totalParcelas: number,
  valorParcela: number
): string {
  const sinal = c.tipo === 'pagar' ? '−' : '+';
  const tipoLabel = c.tipo === 'pagar' ? 'A pagar' : 'A receber';
  if (totalParcelas > 1) {
    return (
      `📌 *${tipoLabel}* (parcelado): ${c.descricao}\n` +
      `💰 Total: ${sinal}${formatBRL(Number(c.valor_total))}\n` +
      `📅 ${totalParcelas}x de ${sinal}${formatBRL(valorParcela)} (${c.recorrencia})`
    );
  }
  const vencLabel = c.data_vencimento ? `, vence ${formatarDataBR(c.data_vencimento)}` : ', sem prazo';
  return `📌 ${tipoLabel}: ${sinal}${formatBRL(Number(c.valor_total))} (${c.descricao})${vencLabel}.`;
}

export async function listarCompromissos(
  userId: string,
  opts: { tipo?: 'pagar' | 'receber' | 'ambos'; apenasPendentes?: boolean; limite?: number } = {}
): Promise<Compromisso[]> {
  const supabase = createServiceClient();
  let q = supabase
    .from('compromissos')
    .select('*')
    .eq('user_id', userId)
    .order('pago', { ascending: true })
    .order('data_vencimento', { ascending: true, nullsFirst: false })
    .limit(opts.limite ?? 50);

  if (opts.tipo && opts.tipo !== 'ambos') q = q.eq('tipo', opts.tipo);
  if (opts.apenasPendentes) q = q.eq('pago', false);

  const { data } = await q;
  return (data ?? []) as Compromisso[];
}

export async function listarParcelas(
  userId: string,
  opts: { apenasPendentes?: boolean; proximasDias?: number; limite?: number } = {}
): Promise<(CompromissoParcela & { compromisso?: Compromisso })[]> {
  const supabase = createServiceClient();
  let q = supabase
    .from('compromisso_parcelas')
    .select('*, compromisso:compromissos(*)')
    .eq('user_id', userId)
    .order('data_vencimento', { ascending: true })
    .limit(opts.limite ?? 50);

  if (opts.apenasPendentes) q = q.eq('pago', false);
  if (opts.proximasDias) {
    const hoje = new Date();
    const limite = new Date();
    limite.setDate(limite.getDate() + opts.proximasDias);
    q = q
      .gte('data_vencimento', hoje.toISOString().slice(0, 10))
      .lte('data_vencimento', limite.toISOString().slice(0, 10));
  }

  const { data } = await q;
  return (data ?? []) as (CompromissoParcela & { compromisso?: Compromisso })[];
}

export async function marcarParcelaPaga(parcelaId: string, userId: string): Promise<Result> {
  const supabase = createServiceClient();

  const { data: parcela, error: fetchErr } = await supabase
    .from('compromisso_parcelas')
    .select('*, compromisso:compromissos(*)')
    .eq('id', parcelaId)
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchErr || !parcela) return { reply: '⚠️ Parcela não encontrada.', ok: false };

  const { error } = await supabase
    .from('compromisso_parcelas')
    .update({ pago: true, pago_em: new Date().toISOString() })
    .eq('id', parcelaId)
    .eq('user_id', userId);

  if (error) return { reply: `⚠️ Erro: ${error.message}`, ok: false };

  // Atualiza valor_pago e parcela_atual no compromisso-pai
  const novoValorPago = Number(parcela.compromisso.valor_pago) + Number(parcela.valor);
  const todasParcelasPagas =
    Number(parcela.numero) === Number(parcela.compromisso.total_parcelas);

  await supabase
    .from('compromissos')
    .update({
      valor_pago: novoValorPago,
      parcela_atual: Number(parcela.numero) + 1,
      pago: todasParcelasPagas,
      pago_em: todasParcelasPagas ? new Date().toISOString() : null,
    })
    .eq('id', parcela.compromisso_id)
    .eq('user_id', userId);

  const c = parcela.compromisso as Compromisso;
  return {
    reply: `✅ Parcela ${parcela.numero}/${c.total_parcelas} de "${c.descricao}" marcada como paga.`,
    ok: true,
  };
}

export async function resumoCompromissos(userId: string): Promise<string> {
  // Lista parcelas pendentes próximas (próximos 60 dias)
  const parcelas = await listarParcelas(userId, { apenasPendentes: true, proximasDias: 60, limite: 20 });
  if (parcelas.length === 0) {
    const pendentes = await listarCompromissos(userId, { apenasPendentes: true });
    if (pendentes.length === 0) return '🎉 Nenhum compromisso pendente. Você tá em dia!';
  }

  let totalPagar = 0;
  let totalReceber = 0;
  for (const p of parcelas) {
    const c = p.compromisso!;
    if (c.tipo === 'pagar') totalPagar += Number(p.valor);
    else totalReceber += Number(p.valor);
  }

  let msg = `📋 *Compromissos pendentes* (${parcelas.length}):\n\n`;
  for (const p of parcelas) {
    const c = p.compromisso!;
    const emoji = c.tipo === 'pagar' ? '🔴' : '🟢';
    const sinal = c.tipo === 'pagar' ? '−' : '+';
    const dias = diasAte(p.data_vencimento);
    const vencLabel = dias === 0 ? 'HOJE' : dias === 1 ? 'AMANHÃ' : `${dias}d`;
    msg += `${emoji} ${vencLabel} • ${sinal}${formatBRL(Number(p.valor))} • ${c.descricao} (${p.numero}/${c.total_parcelas})\n`;
  }

  msg += `\n💸 *A pagar:* ${formatBRL(totalPagar)}`;
  msg += `\n💰 *A receber:* ${formatBRL(totalReceber)}`;
  msg += `\n📊 *Saldo:* ${formatBRL(totalReceber - totalPagar)}`;
  return msg;
}

function diasAte(dataIso: string): number {
  const alvo = new Date(dataIso + 'T00:00:00');
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((alvo.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
}

export function formatarDataBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
