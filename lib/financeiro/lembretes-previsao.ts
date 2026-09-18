/**
 * Agendamento de lembretes proativos (#4) baseados em padrões.
 *
 * Pra cada pattern com next_expected_date entre hoje e +7 dias,
 * gera um lembrete com motivo='previsao_conta' pra disparar às 09:00
 * do dia previsto (ou 09:00 do dia seguinte se a data já passou).
 *
 * Idempotente: checa se já existe lembrete pendente pro mesmo pattern.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { formatBRL, todayISO } from '@/lib/utils';

const LABEL: Record<string, string> = {
  aluguel: 'Aluguel',
  condominio: 'Condomínio',
  iptu: 'IPTU',
  financiamento: 'Financiamento',
  luz: 'Conta de luz',
  agua: 'Conta de água',
  gas: 'Conta de gás',
  internet: 'Internet',
  telefone: 'Telefone',
  tv: 'TV',
  netflix: 'Netflix',
  spotify: 'Spotify',
  academia: 'Academia',
  plano_saude: 'Plano de saúde',
};

function diasAte(dataISO: string): number {
  const alvo = new Date(dataISO + 'T00:00:00');
  const hoje = new Date(todayISO() + 'T00:00:00');
  return Math.round((alvo.getTime() - hoje.getTime()) / 86400000);
}

function rotuloVencimento(dias: number): string {
  if (dias < 0) return `atrasado ${Math.abs(dias)}d`;
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'amanhã';
  return `em ${dias}d`;
}

export interface PatternRow {
  pattern_key: string;
  next_expected_date: string;
  next_expected_amount: number | null;
  avg_amount: number;
  day_of_month: number | null;
  sample_count: number;
}

export async function agendarLembretesPrevisao(
  userId: string,
  patterns: PatternRow[],
): Promise<{ criados: number; erros: number }> {
  const supabase = createServiceClient();
  let criados = 0;
  let erros = 0;

  for (const p of patterns) {
    if (!p.next_expected_date) continue;

    const dias = diasAte(p.next_expected_date);

    // Só agenda se a previsão está entre -1 (atrasado) e +7 dias
    if (dias < -1 || dias > 7) continue;

    // Verifica idempotência: já tem lembrete pendente pra esse pattern?
    const { data: jaCriado } = await supabase
      .from('lembretes_agendados')
      .select('id')
      .eq('user_id', userId)
      .eq('motivo', 'previsao_conta')
      .like('message_text', `%${p.pattern_key}%`)
      .is('disparado_em', null)
      .is('cancelado_em', null)
      .limit(1);

    if (jaCriado && jaCriado.length > 0) continue;

    const [categoria, kw] = p.pattern_key.split(':');
    const label = LABEL[kw] ?? kw ?? categoria ?? 'conta';
    const valor = p.next_expected_amount ?? p.avg_amount;

    const messageText =
      `💡 ${label} ${rotuloVencimento(dias)} (~${formatBRL(Number(valor))}, ` +
      `baseado nos últimos ${p.sample_count} meses).\n\n` +
      `Já pagou? Responde *"gastei ${Number(valor).toFixed(0)} de ${kw ?? categoria}"* pra registrar.`;

    // Agendar pra 09:00 do dia da previsão (ou hoje 09:00 se atrasado)
    let dispararEm: Date;
    if (dias <= 0) {
      dispararEm = new Date();
      dispararEm.setHours(9, 0, 0, 0);
      if (dispararEm.getTime() < Date.now()) {
        // já passou das 9h hoje → dispara em 5min
        dispararEm = new Date(Date.now() + 5 * 60 * 1000);
      }
    } else {
      dispararEm = new Date(p.next_expected_date + 'T00:00:00');
      dispararEm.setHours(9, 0, 0, 0);
    }

    const { error } = await supabase.from('lembretes_agendados').insert({
      user_id: userId,
      motivo: 'previsao_conta',
      message_text: messageText,
      disparar_em: dispararEm.toISOString(),
    });

    if (error) {
      console.warn('[previsao_conta] INSERT falhou:', error.message);
      erros++;
    } else {
      criados++;
    }
  }

  return { criados, erros };
}
