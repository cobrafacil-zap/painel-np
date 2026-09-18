/**
 * Agendamento e disparo de lembretes de tarefas.
 *
 * Regras (definidas com o usuário — versão expandida):
 *  - Compromisso (tem hora, não-recorrente):
 *      - aviso_previo: 1 dia antes, MESMO horário.
 *      - aviso_30min:  30 minutos antes.
 *      - aviso_15min:  15 minutos antes.
 *  - Compromisso recorrente (semanal/mensal):
 *      - aviso_curto:  1h15 antes.
 *      - aviso_30min: 30 minutos antes.
 *      (sem aviso de 1 dia — recorrente geralmente já tá no calendário.)
 *  - Prazo (só data):
 *      - aviso_previo: 2 dias antes às 08:00 local.
 *      - aviso_imediato: manhã do dia (08:00 local).
 *  - Atraso: gerado sob demanda pelo cron, diariamente 09:00,
 *    máx 5 dias após vencimento.
 *
 * Idempotência: o cron usa `gerarLembretesAtraso` que checa se já
 * existe um lembrete `atraso_diario` criado/disparado HOJE pra tarefa.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { evolutionEnviarTexto } from '@/lib/evolution';
import type { Tarefa, LembreteAgendado } from '@/lib/types';
import { formatarLembrete } from './mensagens';

type ReminderMotivo =
  | 'aviso_previo'
  | 'aviso_imediato'
  | 'aviso_30min'
  | 'aviso_15min'
  | 'aviso_curto'
  | 'atraso_diario';

type TarefaComJornada = Tarefa & {
  profile: { whatsapp_group_jid: string | null; evolution_instance_name: string | null } | null;
};

/**
 * Gera os lembretes iniciais de uma tarefa recém-criada.
 * Retorna os IDs das linhas inseridas em lembretes_agendados.
 */
export async function gerarLembretesIniciais(tarefaId: string): Promise<string[]> {
  const supabase = createServiceClient();
  const { data: t, error } = await supabase
    .from('tarefas')
    .select('*')
    .eq('id', tarefaId)
    .maybeSingle();
  if (error || !t) return [];

  const tarefa = t as Tarefa;
  const linhas: { motivo: ReminderMotivo; disparar_em: string }[] = [];

  // Combinar data + hora em timestamp local. tarefa.data_prazo é 'YYYY-MM-DD',
  // tarefa.hora_prazo é 'HH:MM:SS' ou null.
  const dataBase = parseDataHora(tarefa.data_prazo, tarefa.hora_prazo);

  if (tarefa.tipo === 'compromisso' && dataBase) {
    if (tarefa.recorrencia) {
      // Compromisso recorrente: só curto prazo (1h15 + 30min antes).
      // Não gera aviso de 1 dia porque recorrente geralmente já tá no
      // calendário mental do usuário.
      const aviso1h15 = new Date(dataBase);
      aviso1h15.setMinutes(aviso1h15.getMinutes() - 75);
      linhas.push({ motivo: 'aviso_curto', disparar_em: aviso1h15.toISOString() });

      const aviso30 = new Date(dataBase);
      aviso30.setMinutes(aviso30.getMinutes() - 30);
      linhas.push({ motivo: 'aviso_30min', disparar_em: aviso30.toISOString() });
    } else {
      // Compromisso normal: 3 avisos (1 dia antes + 30min + 15min).
      const avisoPrevio = new Date(dataBase);
      avisoPrevio.setDate(avisoPrevio.getDate() - 1);
      linhas.push({ motivo: 'aviso_previo', disparar_em: avisoPrevio.toISOString() });

      const aviso30 = new Date(dataBase);
      aviso30.setMinutes(aviso30.getMinutes() - 30);
      linhas.push({ motivo: 'aviso_30min', disparar_em: aviso30.toISOString() });

      const aviso15 = new Date(dataBase);
      aviso15.setMinutes(aviso15.getMinutes() - 15);
      linhas.push({ motivo: 'aviso_15min', disparar_em: aviso15.toISOString() });
    }
  } else if (tarefa.tipo === 'prazo') {
    // aviso_previo: 2 dias antes às 08:00
    const [y, m, d] = tarefa.data_prazo.split('-').map(Number);
    const avisoPrevio = new Date(y, m - 1, d - 2, 8, 0, 0);
    linhas.push({ motivo: 'aviso_previo', disparar_em: avisoPrevio.toISOString() });

    // aviso_imediato: 08:00 do dia
    const avisoImediato = new Date(y, m - 1, d, 8, 0, 0);
    linhas.push({ motivo: 'aviso_imediato', disparar_em: avisoImediato.toISOString() });
  }

  // Não inserir lembretes no passado (ex: tarefa criada com data que já passou)
  const agora = new Date();
  const linhasFuturas = linhas.filter((l) => new Date(l.disparar_em).getTime() > agora.getTime());

  if (linhasFuturas.length === 0) return [];

  const rows = linhasFuturas.map((l) => ({
    user_id: tarefa.user_id,
    tarefa_id: tarefa.id,
    canal: 'whatsapp' as const,
    motivo: l.motivo,
    disparar_em: l.disparar_em,
  }));

  const { data: inserted } = await supabase
    .from('lembretes_agendados')
    .insert(rows)
    .select('id');

  return (inserted ?? []).map((r: { id: string }) => r.id);
}

/**
 * Cancela TODOS os lembretes pendentes (não disparados) de uma tarefa.
 * Chamado quando a tarefa é concluída, cancelada ou editada
 * (antes de regenerar).
 */
export async function cancelarLembretesPendente(
  tarefaId: string,
  motivo: string = 'cancelado'
): Promise<number> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('lembretes_agendados')
    .update({ cancelado_em: new Date().toISOString(), erro: motivo })
    .eq('tarefa_id', tarefaId)
    .is('disparado_em', null)
    .is('cancelado_em', null)
    .select('id');
  return (data ?? []).length;
}

/**
 * Para cada tarefa pendente vencida (data_prazo < hoje), gera UM lembrete
 * de atraso para HOJE (se já passou das 9h, dispara imediato). Idempotente
 * no mesmo dia. Limite: 5 dias após vencimento.
 *
 * Retorna quantidade de lembretes criados.
 */
export async function gerarLembretesAtraso(): Promise<number> {
  const supabase = createServiceClient();
  const hojeISO = new Date().toISOString().slice(0, 10);
  const limiteISO = new Date();
  limiteISO.setDate(limiteISO.getDate() - 5);
  const limiteISOstr = limiteISO.toISOString().slice(0, 10);

  // Tarefas pendentes vencidas (data_prazo entre limite e hoje-1)
  const { data: tarefas } = await supabase
    .from('tarefas')
    .select('id, user_id, data_prazo')
    .eq('status', 'pendente')
    .lt('data_prazo', hojeISO)
    .gte('data_prazo', limiteISOstr);

  if (!tarefas || tarefas.length === 0) return 0;

  // Pra cada, checar se já tem lembrete atraso_diario criado HOJE
  let criados = 0;
  for (const t of tarefas) {
    const { data: existe } = await supabase
      .from('lembretes_agendados')
      .select('id')
      .eq('tarefa_id', t.id)
      .eq('motivo', 'atraso_diario')
      .gte('created_at', `${hojeISO}T00:00:00Z`)
      .limit(1);

    if (existe && existe.length > 0) continue;

    // disparar_em = 09:00 de hoje; se já passou, dispara agora
    const agora = new Date();
    const nineAM = new Date();
    nineAM.setHours(9, 0, 0, 0);
    const dispararEm = agora > nineAM ? agora : nineAM;

    await supabase.from('lembretes_agendados').insert({
      user_id: t.user_id,
      tarefa_id: t.id,
      canal: 'whatsapp',
      motivo: 'atraso_diario',
      disparar_em: dispararEm.toISOString(),
    });
    criados++;
  }
  return criados;
}

/**
 * Dispara todos os lembretes vencidos (`disparar_em <= now()`). Marca
 * `disparado_em` em sucesso, incrementa `tentativas` em erro. Desiste
 * após 3 tentativas.
 *
 * Retorna `{ disparados, erros, desistidos }`.
 */
export async function dispararLembretesVencidos(): Promise<{
  disparados: number;
  erros: number;
  desistidos: number;
}> {
  const supabase = createServiceClient();
  const agoraISO = new Date().toISOString();

  const { data: lembretes } = await supabase
    .from('lembretes_agendados')
    .select(
      'id, user_id, tarefa_id, motivo, tentativas, tarefa:tarefas!inner(id, titulo, data_prazo, hora_prazo, status, user_id), profile:profiles!lembretes_agendados_user_id_fkey(whatsapp_group_jid, evolution_instance_name)'
    )
    .is('disparado_em', null)
    .is('cancelado_em', null)
    .lte('disparar_em', agoraISO)
    .order('disparar_em', { ascending: true })
    .limit(50);

  let disparados = 0;
  let erros = 0;
  let desistidos = 0;

  for (const l of lembretes ?? []) {
    const tarefa = (l as any).tarefa as Tarefa;
    const profile = (l as any).profile as TarefaComJornada['profile'];
    const motivo = l.motivo as ReminderMotivo;

    // Se a tarefa já foi concluída/cancelada entre o agendamento e o disparo,
    // marca como cancelada e segue.
    if (tarefa?.status && tarefa.status !== 'pendente') {
      await supabase
        .from('lembretes_agendados')
        .update({
          cancelado_em: new Date().toISOString(),
          erro: `tarefa ${tarefa.status}`,
        })
        .eq('id', l.id);
      continue;
    }

    if (!profile?.whatsapp_group_jid) {
      await supabase
        .from('lembretes_agendados')
        .update({
          tentativas: (l.tentativas ?? 0) + 1,
          erro: 'profile sem whatsapp_group_jid',
        })
        .eq('id', l.id);
      erros++;
      continue;
    }

    const texto = formatarLembrete(
      { titulo: tarefa.titulo, data_prazo: tarefa.data_prazo, hora_prazo: tarefa.hora_prazo },
      motivo
    );

    try {
      await evolutionEnviarTexto(
        profile.whatsapp_group_jid,
        texto,
        0,
        30_000,
        profile.evolution_instance_name ?? undefined
      );
      await supabase
        .from('lembretes_agendados')
        .update({ disparado_em: new Date().toISOString() })
        .eq('id', l.id);
      disparados++;
    } catch (e: any) {
      const tentativas = (l.tentativas ?? 0) + 1;
      const desistir = tentativas >= 3;
      await supabase
        .from('lembretes_agendados')
        .update({
          tentativas,
          erro: desistir
            ? `${e?.message ?? 'erro'} (desistiu após 3 tentativas)`
            : e?.message ?? 'erro',
          cancelado_em: desistir ? new Date().toISOString() : null,
        })
        .eq('id', l.id);
      if (desistir) desistidos++;
      else erros++;
    }
  }

  return { disparados, erros, desistidos };
}

/**
 * Helper: monta um Date combinando YYYY-MM-DD e HH:MM:SS. Retorna null
 * se hora ausente (tipo='prazo').
 */
function parseDataHora(dataISO: string, horaHMS: string | null): Date | null {
  const [y, m, d] = dataISO.split('-').map(Number);
  if (!y || !m || !d) return null;
  if (!horaHMS) return null;
  const [hh, mm, ss] = horaHMS.split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0, 0);
}
