/**
 * Insights mensais automáticos (#7).
 *
 * Roda dia 1 de cada mês às 09:00 (cron 0 9 1 * *) e gera um
 * lembrete WhatsApp com motivo='insight_mensal' pra cada user ativo
 * que tenha records no mês anterior. Mensagem: total receitas,
 * total gastos, saldo, top 3 categorias, % variação vs mês anterior.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { formatBRL } from '@/lib/utils';

interface MesResumo {
  periodo: string; // 'YYYY-MM'
  totalReceitas: number;
  totalGastos: number;
  saldo: number;
  topCategorias: Array<{ categoria: string; total: number }>;
}

function startEnd(periodo: string): { from: string; to: string } {
  const [ano, mes] = periodo.split('-').map(Number);
  const from = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const lastDay = new Date(ano, mes, 0).getDate();
  const to = `${ano}-${String(mes).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

async function calcularResumo(
  userId: string,
  periodo: string,
): Promise<MesResumo> {
  const supabase = createServiceClient();
  const { from, to } = startEnd(periodo);

  const { data: records } = await supabase
    .from('records')
    .select('type, amount, category')
    .eq('user_id', userId)
    .eq('module_id', 'financeiro')
    .gte('occurred_at', from)
    .lte('occurred_at', to);

  let totalReceitas = 0;
  let totalGastos = 0;
  const catMap = new Map<string, number>();

  for (const r of records ?? []) {
    const amt = Number(r.amount);
    if (r.type === 'receita') totalReceitas += amt;
    else if (r.type === 'gasto') {
      totalGastos += amt;
      const cat = r.category ?? 'outros';
      catMap.set(cat, (catMap.get(cat) ?? 0) + amt);
    }
  }

  const topCategorias = Array.from(catMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([categoria, total]) => ({ categoria, total }));

  return {
    periodo,
    totalReceitas,
    totalGastos,
    saldo: totalReceitas - totalGastos,
    topCategorias,
  };
}

function formatarMensagem(atual: MesResumo, anterior: MesResumo): string {
  const variacao =
    anterior.totalGastos > 0
      ? Math.round(((atual.totalGastos - anterior.totalGastos) / anterior.totalGastos) * 100)
      : 0;
  const sinal = variacao > 0 ? '+' : '';
  const tendencia =
    variacao > 5
      ? `📈 Você gastou *${sinal}${variacao}%* a mais que ${anterior.periodo}.`
      : variacao < -5
        ? `📉 Você gastou *${variacao}%* menos que ${anterior.periodo}. Boa!`
        : `📊 Gasto parecido com ${anterior.periodo} (${variacao >= 0 ? '+' : ''}${variacao}%).`;

  let top = '';
  if (atual.topCategorias.length > 0) {
    const linhas = atual.topCategorias
      .map((c, i) => `${i + 1}. ${c.categoria} ${formatBRL(c.total)}`)
      .join('\n');
    top = `\n\n*Top 3 categorias:*\n${linhas}`;
  }

  return (
    `📊 *${atual.periodo} fechou!*\n\n` +
    `💸 Gastos: ${formatBRL(atual.totalGastos)}\n` +
    `💰 Receitas: ${formatBRL(atual.totalReceitas)}\n` +
    `${atual.saldo >= 0 ? '✅' : '❌'} Saldo: ${formatBRL(atual.saldo)}` +
    top +
    `\n\n${tendencia}`
  );
}

function periodoAnterior(periodo: string): string {
  const [ano, mes] = periodo.split('-').map(Number);
  const d = new Date(ano, mes - 2, 1); // -2 porque mes-1 dá mês atual, queremos ir 1 antes
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export interface InsightGerado {
  userId: string;
  periodo: string;
  messageText: string;
}

export async function gerarInsightsMesAnterior(): Promise<{
  gerados: InsightGerado[];
  erros: number;
}> {
  const supabase = createServiceClient();

  // Determina mês anterior (se hoje é 2026-09-18, gera insight de agosto)
  const hoje = new Date();
  const mesAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const periodoAtual = `${mesAnterior.getFullYear()}-${String(mesAnterior.getMonth() + 1).padStart(2, '0')}`;
  const periodoAnt = periodoAnterior(periodoAtual);

  // Busca users ativos (têm profile + instância vinculada)
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, evolution_instance_name')
    .not('evolution_instance_name', 'is', null);

  const userIds = (profiles ?? []).map((p: any) => p.id);

  const gerados: InsightGerado[] = [];
  let erros = 0;

  for (const userId of userIds) {
    try {
      const atual = await calcularResumo(userId, periodoAtual);
      // Pula se não tem atividade no mês
      if (atual.totalReceitas === 0 && atual.totalGastos === 0) continue;

      const anterior = await calcularResumo(userId, periodoAnt);
      const messageText = formatarMensagem(atual, anterior);

      // Idempotência: checa se já tem lembrete desse mês pra esse user
      const { data: ja } = await supabase
        .from('lembretes_agendados')
        .select('id')
        .eq('user_id', userId)
        .eq('motivo', 'insight_mensal')
        .like('message_text', `%${periodoAtual} fechou%`)
        .limit(1);

      if (ja && ja.length > 0) continue;

      // Dispara "agora" (cron mensal)
      const dispararEm = new Date();
      dispararEm.setHours(9, 0, 0, 0);
      if (dispararEm.getTime() < Date.now()) {
        dispararEm.setTime(Date.now() + 5 * 60 * 1000);
      }

      const { error } = await supabase.from('lembretes_agendados').insert({
        user_id: userId,
        motivo: 'insight_mensal',
        message_text: messageText,
        disparar_em: dispararEm.toISOString(),
      });

      if (error) {
        console.warn('[insight_mensal] INSERT falhou:', error.message);
        erros++;
        continue;
      }

      gerados.push({ userId, periodo: periodoAtual, messageText });
    } catch (e) {
      console.warn('[insight_mensal] erro user:', userId, e);
      erros++;
    }
  }

  return { gerados, erros };
}
