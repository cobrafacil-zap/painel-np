/**
 * Lembretes proativos pra #8 ("Esqueci de pagar").
 *
 * Roda 1x/dia (cron 0 10 * * *) e gera lembrete WhatsApp pra cada
 * compromisso_parcela vencida entre hoje-7 e hoje-1 (não dispara pra
 * muito antigo). Idempotente: checa se já tem lembrete pendente do
 * mesmo motivo pra mesma parcela antes de criar.
 *
 * Mensagem: "💸 Conta de X venceu anteontem (R$ Y). Já pagou? Responde
 * 'paguei X' pra eu marcar."
 */

import { createServiceClient } from '@/lib/supabase/server';
import { formatBRL, todayISO } from '@/lib/utils';

type CompromissoRow = {
  id: string;
  user_id: string;
  descricao: string;
};

type ParcelaRow = {
  id: string;
  compromisso_id: string;
  numero: number;
  valor: number;
  data_vencimento: string;
};

export interface LembreteCompromissoGerado {
  userId: string;
  parcelaId: string;
  descricao: string;
  valor: number;
  dataVencimento: string;
  messageText: string;
}

function diasAtraso(dataVenc: string): number {
  const hoje = new Date(todayISO() + 'T00:00:00');
  const venc = new Date(dataVenc + 'T00:00:00');
  return Math.floor((hoje.getTime() - venc.getTime()) / 86400000);
}

function rotuloAtraso(dias: number): string {
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  return `há ${dias} dias`;
}

export async function gerarLembretesCompromissosVencidos(): Promise<{
  gerados: LembreteCompromissoGerado[];
  erros: number;
}> {
  const supabase = createServiceClient();
  const hoje = todayISO();
  const semanaAtras = new Date(Date.now() - 7 * 86400000)
    .toISOString()
    .slice(0, 10);

  // Busca parcelas vencidas (entre 7 dias atrás e hoje) e não pagas
  const { data: parcelas, error: parcErr } = await supabase
    .from('compromisso_parcelas')
    .select('id, compromisso_id, numero, valor, data_vencimento')
    .eq('pago', false)
    .gte('data_vencimento', semanaAtras)
    .lte('data_vencimento', hoje);

  if (parcErr) {
    console.warn('[compromisso-vencido] SELECT parcelas falhou:', parcErr.message);
    return { gerados: [], erros: 1 };
  }

  const rows = (parcelas ?? []) as ParcelaRow[];
  if (rows.length === 0) return { gerados: [], erros: 0 };

  // Busca os compromissos correspondentes pra descrição
  const compromissoIds = Array.from(new Set(rows.map((r) => r.compromisso_id)));
  const { data: comps } = await supabase
    .from('compromissos')
    .select('id, user_id, descricao')
    .in('id', compromissoIds);
  const compMap = new Map<string, CompromissoRow>(
    ((comps ?? []) as CompromissoRow[]).map((c) => [c.id, c]),
  );

  // Verifica se já tem lembrete pendente pra essas parcelas
  const parcelaIds = rows.map((r) => r.id);
  const { data: lembretesJa } = await supabase
    .from('lembretes_agendados')
    .select('parcela_id')
    .eq('motivo', 'compromisso_vencido')
    .in('parcela_id', parcelaIds)
    .eq('enviado', false);
  const jaCriados = new Set<string>(
    ((lembretesJa ?? []) as { parcela_id: string }[])
      .map((l) => l.parcela_id)
      .filter(Boolean) as string[],
  );

  const gerados: LembreteCompromissoGerado[] = [];
  let erros = 0;

  for (const parc of rows) {
    if (jaCriados.has(parc.id)) continue;

    const comp = compMap.get(parc.compromisso_id);
    if (!comp) continue;

    const dias = diasAtraso(parc.data_vencimento);
    const messageText =
      `💸 *${comp.descricao}* venceu ${rotuloAtraso(dias)} (${formatBRL(Number(parc.valor))}).\n\n` +
      `Já pagou? Responde *"paguei ${comp.descricao}"* pra eu marcar a parcela ${parc.numero} como paga.`;

    const { error } = await supabase.from('lembretes_agendados').insert({
      user_id: comp.user_id,
      parcela_id: parc.id,
      motivo: 'compromisso_vencido',
      message_text: messageText,
      // Disparar na próxima janela do cron de 5min
      disparar_em: new Date().toISOString(),
      enviado: false,
    });

    if (error) {
      console.warn('[compromisso-vencido] INSERT falhou:', error.message);
      erros++;
      continue;
    }

    gerados.push({
      userId: comp.user_id,
      parcelaId: parc.id,
      descricao: comp.descricao,
      valor: Number(parc.valor),
      dataVencimento: parc.data_vencimento,
      messageText,
    });
  }

  return { gerados, erros };
}
