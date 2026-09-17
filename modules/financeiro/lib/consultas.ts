import { createServiceClient } from '@/lib/supabase/server';
import { formatBRL, startOfMonthISO, endOfMonthISO } from '@/lib/utils';
import type { ParsedIntent } from './parser-mensagem';
import { resumoCompromissos, listarParcelas } from './compromissos';

type Periodo = 'hoje' | 'semana' | 'mes' | 'mes_passado' | 'tudo';

interface ConsultResult {
  reply: string;
}

function isoDateRange(periodo: Periodo): { from: string; to: string; label: string } {
  const today = new Date();
  switch (periodo) {
    case 'hoje':
      return { from: today.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10), label: 'hoje' };
    case 'semana': {
      const d = new Date(today);
      d.setDate(d.getDate() - 6);
      return { from: d.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10), label: 'últimos 7 dias' };
    }
    case 'mes':
      return { from: startOfMonthISO(today), to: endOfMonthISO(today), label: 'esse mês' };
    case 'mes_passado': {
      const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return { from: startOfMonthISO(d), to: endOfMonthISO(d), label: 'mês passado' };
    }
    case 'tudo':
    default:
      return { from: '1970-01-01', to: '2999-12-31', label: 'todo o período' };
  }
}

export async function responderConsulta(userId: string, intent: Extract<ParsedIntent, { intent: 'consulta' }>): Promise<ConsultResult> {
  const supabase = createServiceClient();
  const { from, to, label } = isoDateRange(intent.periodo);

  if (intent.tipo === 'saldo' || intent.tipo === 'gastos' || intent.tipo === 'receitas') {
    let q = supabase
      .from('records')
      .select('type, amount')
      .eq('user_id', userId)
      .eq('module_id', 'financeiro')
      .gte('occurred_at', from)
      .lte('occurred_at', to);

    if (intent.tipo !== 'saldo') q = q.eq('type', intent.tipo === 'gastos' ? 'gasto' : 'receita');
    if (intent.categoria) q = q.eq('category', intent.categoria);

    const { data, error } = await q;
    if (error) return { reply: `Erro ao consultar: ${error.message}` };

    const rows = data ?? [];
    if (intent.tipo === 'saldo') {
      const receitas = rows.filter((r) => r.type === 'receita').reduce((s, r) => s + Number(r.amount), 0);
      const gastos = rows.filter((r) => r.type === 'gasto').reduce((s, r) => s + Number(r.amount), 0);
      const saldo = receitas - gastos;
      const sinal = saldo >= 0 ? '🟢 positivo' : '🔴 negativo';
      return { reply: `Saldo de ${label}: ${formatBRL(saldo)} (${sinal})\nReceitas: ${formatBRL(receitas)} · Gastos: ${formatBRL(gastos)}` };
    }

    const total = rows.reduce((s, r) => s + Number(r.amount), 0);
    const tipoLabel = intent.tipo === 'gastos' ? 'gastos' : 'receitas';
    const catLabel = intent.categoria ? ` em '${intent.categoria}'` : '';
    return { reply: `Total de ${tipoLabel}${catLabel} em ${label}: ${formatBRL(total)} (${rows.length} lançamento${rows.length === 1 ? '' : 's'})` };
  }

  if (intent.tipo === 'top_categoria') {
    let q = supabase
      .from('records')
      .select('category, amount')
      .eq('user_id', userId)
      .eq('module_id', 'financeiro')
      .eq('type', 'gasto')
      .gte('occurred_at', from)
      .lte('occurred_at', to);
    if (intent.categoria) q = q.eq('category', intent.categoria);

    const { data, error } = await q;
    if (error) return { reply: `Erro: ${error.message}` };

    const soma: Record<string, number> = {};
    for (const r of data ?? []) {
      const cat = r.category ?? 'sem categoria';
      soma[cat] = (soma[cat] ?? 0) + Number(r.amount);
    }
    const ranking = Object.entries(soma).sort((a, b) => b[1] - a[1]);
    if (ranking.length === 0) return { reply: `Sem gastos registrados em ${label}.` };

    const top3 = ranking.slice(0, 3).map(([cat, total], i) => `${i + 1}. ${cat}: ${formatBRL(total)}`).join('\n');
    return { reply: `🏆 Top categorias em ${label}:\n${top3}` };
  }

  if (intent.tipo === 'compromissos') {
    return { reply: await resumoCompromissos(userId) };
  }

  if (intent.tipo === 'parcelas') {
    const parcelas = await listarParcelas(userId, { apenasPendentes: true, proximasDias: 90, limite: 30 });
    if (parcelas.length === 0) {
      return { reply: '🎉 Nenhuma parcela pendente nos próximos 90 dias.' };
    }
    let msg = `📅 *Suas próximas parcelas* (${parcelas.length}):\n\n`;
    for (const p of parcelas) {
      const c = p.compromisso!;
      const sinal = c.tipo === 'pagar' ? '−' : '+';
      const dias = diasAte(p.data_vencimento);
      const labelVenc = dias < 0 ? `${Math.abs(dias)}d ATRASADO` : dias === 0 ? 'HOJE' : dias === 1 ? 'AMANHÃ' : `${dias}d`;
      msg += `${sinal}${formatBRL(Number(p.valor))} • ${labelVenc} • ${c.descricao} (${p.numero}/${c.total_parcelas})\n`;
    }
    return { reply: msg };
  }

  return { reply: 'Não entendi a consulta. Tente reformular.' };
}

function diasAte(dataIso: string): number {
  const alvo = new Date(dataIso + 'T00:00:00');
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((alvo.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
}
