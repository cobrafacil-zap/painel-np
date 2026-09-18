/**
 * Formatadores de mensagens do módulo Tarefas.
 *
 * - formatarConfirmacaoTarefa: resposta curta enviada ao grupo logo
 *   após criar uma tarefa via WhatsApp.
 * - formatarLembrete: texto enviado pelo cron quando o lembrete dispara.
 * - mensagemAmbiguidade: perguntas que o bot faz quando o input é
 *   ambíguo (sem data, hora sem dia, categoria duvidosa, conflito
 *   tarefa↔financeiro).
 */

import type { Tarefa, LembreteAgendado } from '@/lib/types';
import { formatDateBR } from '@/lib/utils';

export type AmbiguidadeMotivo =
  | 'sem_data'
  | 'sem_data_com_hora'
  | 'categoria_duvidosa'
  | 'financeiro_ou_tarefa';

const DIAS_PT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function diaSemanaCurto(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return DIAS_PT[new Date(y, m - 1, d).getDay()];
}

function horaCurta(hms: string | null): string {
  if (!hms) return '';
  // 'HH:MM:SS' → 'HH:MM'
  return hms.slice(0, 5);
}

function fmtDataBonita(iso: string): string {
  const dow = diaSemanaCurto(iso);
  return `${dow} ${formatDateBR(iso)}`;
}

/**
 * Resposta enviada no grupo logo após criar a tarefa.
 */
export function formatarConfirmacaoTarefa(
  t: Pick<Tarefa, 'titulo' | 'data_prazo' | 'hora_prazo' | 'tipo' | 'recorrencia'>,
  lembretes: Pick<LembreteAgendado, 'motivo'>[]
): string {
  const hora = horaCurta(t.hora_prazo);
  const dataLinha = hora
    ? `📅 ${fmtDataBonita(t.data_prazo)} às ${hora}`
    : `📅 ${fmtDataBonita(t.data_prazo)} (prazo)`;

  const lembretesLinha = (() => {
    if (lembretes.length === 0) return '🔔 Sem lembretes';
    if (t.tipo === 'compromisso') {
      return lembretes.length >= 2
        ? '🔔 Lembretes: 1 dia antes + 1h15 antes'
        : '🔔 Lembrete: 1 dia antes';
    }
    // prazo
    return '🔔 Lembretes: 2 dias antes + manhã do dia';
  })();

  const tituloLinha = `✅ Tarefa: ${t.titulo}`;

  let recorrenciaLinha = '';
  if (t.recorrencia === 'semanal') recorrenciaLinha = '\n🔁 Toda semana';
  else if (t.recorrencia === 'mensal') recorrenciaLinha = '\n🔁 Todo mês';

  return `${tituloLinha}\n${dataLinha}\n${lembretesLinha}${recorrenciaLinha}`;
}

/**
 * Mensagem que o bot envia ao grupo quando um lembrete dispara.
 */
export function formatarLembrete(
  t: Pick<Tarefa, 'titulo' | 'data_prazo' | 'hora_prazo'>,
  motivo: 'aviso_previo' | 'aviso_imediato' | 'atraso_diario'
): string {
  const hora = horaCurta(t.hora_prazo);
  const quando = hora
    ? `${fmtDataBonita(t.data_prazo)} às ${hora}`
    : fmtDataBonita(t.data_prazo);

  if (motivo === 'atraso_diario') {
    return (
      `🔴 Atrasada: "${t.titulo}"\n` +
      `📅 Venceu em ${fmtDataBonita(t.data_prazo)}\n` +
      `💬 Responda "concluí" ou reage com ✅ pra encerrar.`
    );
  }

  if (motivo === 'aviso_previo') {
    return (
      `⏰ Lembrete: "${t.titulo}"\n` +
      `📅 ${quando}\n` +
      `💬 Responda "concluí" ou reage com ✅ pra marcar como feita.`
    );
  }

  // aviso_imediato
  return (
    `🔔 Lembrete: "${t.titulo}"\n` +
    `📅 ${quando}\n` +
    `💬 Responda "concluí" ou reage com ✅ pra marcar como feita.`
  );
}

/**
 * Perguntas de volta quando o input é ambíguo.
 */
export function mensagemAmbiguidade(motivo: AmbiguidadeMotivo): string {
  switch (motivo) {
    case 'sem_data':
      return '📅 Pra quando? (ex: sexta, dia 20, fim do mês, amanhã)';
    case 'sem_data_com_hora':
      return '📅 Em que dia? Vi que tem horário, mas falta o dia.';
    case 'categoria_duvidosa':
      return '🏷️ Que categoria? (trabalho, pessoal, saúde, estudo, projeto, outros)';
    case 'financeiro_ou_tarefa':
      return '❓ É uma tarefa com prazo ou um gasto realizado agora? Responde "tarefa" ou "gasto".';
  }
}
