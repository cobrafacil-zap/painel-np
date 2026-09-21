/**
 * Relatório diário (#extra) — às 17h (parcial) e às 23h (final).
 *
 * Pra cada user ativo, soma entradas (receitas) e saídas (gastos) do
 * dia atual. Idempotente: 1 lembrete por user por slot (17h ou 23h)
 * por dia. Marca slot no message_text pra deduplicação.
 *
 * Mensagem:
 *   📊 *Relatório 17h* (DD/MM):
 *   💰 Entrou: R$ X
 *   💸 Saiu: R$ Y
 *   Saldo do dia: R$ X-Y
 *   Top categoria: foo (R$ Z)
 */

import { createServiceClient } from '@/lib/supabase/server';
import { formatBRL, todayISO } from '@/lib/utils';
import { getMetaDiaria, formatarIndicadorMeta } from './meta-diaria';
import { listMetasLongas } from './metas-longas';
import { gerarInsightCurto } from './insights';

export type Slot = '17h' | '23h';

interface Resumo {
  totalEntrou: number;
  totalSaiu: number;
  saldo: number;
  topCategoria: { nome: string; total: number } | null;
}

async function calcularResumo(userId: string): Promise<Resumo> {
  const supabase = createServiceClient();
  const hoje = todayISO();

  const { data: records } = await supabase
    .from('records')
    .select('type, amount, category')
    .eq('user_id', userId)
    .eq('module_id', 'financeiro')
    .eq('occurred_at', hoje);

  let totalEntrou = 0;
  let totalSaiu = 0;
  const catMap = new Map<string, number>();

  for (const r of records ?? []) {
    const amt = Number(r.amount);
    if (r.type === 'receita') totalEntrou += amt;
    else if (r.type === 'gasto') {
      totalSaiu += amt;
      const cat = r.category ?? 'outros';
      catMap.set(cat, (catMap.get(cat) ?? 0) + amt);
    }
  }

  const topEntries = Array.from(catMap.entries()).sort((a, b) => b[1] - a[1]);
  const topCategoria =
    topEntries.length > 0
      ? { nome: topEntries[0][0], total: topEntries[0][1] }
      : null;

  return { totalEntrou, totalSaiu, saldo: totalEntrou - totalSaiu, topCategoria };
}

function formatarMensagem(
  slot: Slot,
  r: Resumo,
  meta: number | null,
  insightCurto: string | null,
): string {
  const hoje = new Date(todayISO() + 'T00:00:00').toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  });
  const emoji = slot === '17h' ? '📊' : '🌙';
  const contexto = slot === '17h' ? 'parcial' : 'final';

  const top = r.topCategoria
    ? `\n🏷️ Top gasto: ${r.topCategoria.nome} (${formatBRL(r.topCategoria.total)})`
    : '';

  // Indicador de meta diária (#extra) — só aparece se meta existir
  const metaIndicator = meta != null && meta > 0
    ? `\n${formatarIndicadorMeta(meta, r.totalSaiu)}`
    : '';

  // Insight personalizado (#overhaul metas-largas) — só slot 23h pra
  // não encher o saco no meio da tarde. Pega o mais urgente.
  const insightLine = slot === '23h' && insightCurto
    ? `\n💡 ${insightCurto}`
    : '';

  return (
    `${emoji} *Relatório ${slot}* (${contexto}, ${hoje})\n\n` +
    `💰 Entrou: ${formatBRL(r.totalEntrou)}\n` +
    `💸 Saiu: ${formatBRL(r.totalSaiu)}\n` +
    `${r.saldo >= 0 ? '✅' : '❌'} Saldo do dia: ${formatBRL(r.saldo)}` +
    metaIndicator +
    top +
    insightLine
  );
}

export interface RelatorioGerado {
  userId: string;
  slot: Slot;
  messageText: string;
}

export async function gerarRelatoriosDiarios(slot: Slot): Promise<{
  gerados: RelatorioGerado[];
  erros: number;
}> {
  const supabase = createServiceClient();
  const hoje = todayISO();

  // Busca users ativos
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, evolution_instance_name')
    .not('evolution_instance_name', 'is', null);
  const userIds = (profiles ?? []).map((p: any) => p.id);

  const gerados: RelatorioGerado[] = [];
  let erros = 0;

  for (const userId of userIds) {
    try {
      // Idempotência: checa se já tem lembrete de relatório pra esse slot hoje
      const tag = `Relatório ${slot}* (${slot === '17h' ? 'parcial' : 'final'},`;
      const { data: ja } = await supabase
        .from('lembretes_agendados')
        .select('id')
        .eq('user_id', userId)
        .eq('motivo', 'relatorio_diario')
        .like('message_text', `%${tag}%`)
        .like('message_text', `%${hoje.slice(8, 10)}/${hoje.slice(5, 7)}%`)
        .limit(1);

      if (ja && ja.length > 0) continue;

      const resumo = await calcularResumo(userId);
      const meta = await getMetaDiaria(userId);
      // Tem que checar meta longa também — relatório 23h faz sentido se
      // user tem objetivo financeiro mesmo em dia sem gasto.
      const metasLongas = slot === '23h' ? await listMetasLongas(userId) : [];

      // Regra de envio:
      //   17h → só se teve atividade (não incomoda à tarde sem necessidade)
      //   23h → sempre que tiver meta diária OU meta longa configurada,
      //          mesmo sem gasto no dia (vale como lembrete de saldo vs meta).
      //          Sem nenhuma meta configurada, pula (não tem o que reportar).
      const temAlgumaMeta =
        (meta != null && meta > 0) || metasLongas.length > 0;
      const temAtividade = resumo.totalEntrou > 0 || resumo.totalSaiu > 0;

      if (slot === '17h' && !temAtividade) continue;
      if (slot === '23h' && !temAtividade && !temAlgumaMeta) continue;

      const insightCurto = slot === '23h' ? await gerarInsightCurto(userId) : null;
      const messageText = formatarMensagem(slot, resumo, meta, insightCurto);

      // Dispara já (cron vai rodar 17h/23h, mas a janela de entrega é */5)
      const dispararEm = new Date();
      if (dispararEm.getTime() < Date.now() + 30_000) {
        dispararEm.setTime(Date.now() + 30_000);
      }

      const { error } = await supabase.from('lembretes_agendados').insert({
        user_id: userId,
        motivo: 'relatorio_diario',
        message_text: messageText,
        disparar_em: dispararEm.toISOString(),
      });

      if (error) {
        console.warn('[relatorio_diario] INSERT falhou:', error.message);
        erros++;
        continue;
      }

      gerados.push({ userId, slot, messageText });
    } catch (e) {
      console.warn('[relatorio_diario] erro user:', userId, e);
      erros++;
    }
  }

  return { gerados, erros };
}
