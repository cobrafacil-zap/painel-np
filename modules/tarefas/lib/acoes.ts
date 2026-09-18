/**
 * CRUD + ações do módulo Tarefas.
 *
 * Funções principais:
 *  - criarTarefa: insere tarefa e agenda lembretes iniciais.
 *  - concluirTarefa: marca como concluída e cancela lembretes pendentes.
 *  - concluirTarefaPorTexto: match por trecho do título ("concluí reunião").
 *  - concluirPorReaction: match pelo id da msg de confirmação (handler de ✅).
 *  - listarTarefas, editarTarefa, cancelarTarefa, deletarTarefa.
 */

import { createServiceClient } from '@/lib/supabase/server';
import type { Tarefa, TaskType, TaskPriority } from '@/lib/types';
import {
  gerarLembretesIniciais,
  cancelarLembretesPendente,
} from './lembretes';
import { formatarConfirmacaoTarefa } from './mensagens';

export type TarefaInput = {
  texto_original: string;
  titulo: string;
  descricao?: string | null;
  data_prazo: string;
  hora_prazo?: string | null;
  tipo: TaskType;
  categoria?: string | null;
  prioridade?: TaskPriority;
  recorrencia?: 'semanal' | 'mensal' | null;
  source?: 'manual' | 'whatsapp' | 'importacao';
  source_message_id?: string | null;
};

export type Result = {
  reply: string;
  ok: boolean;
  id?: string;
  lembrete_ids?: string[];
};

/**
 * Cria uma tarefa + agenda os 2 lembretes iniciais (via cron).
 * Retorna a reply curta que será enviada ao grupo, junto com o id.
 *
 * Se source_message_id vier, idempotência via unique index — em caso de
 * reentrega da Evolution, devolve a tarefa já existente.
 */
export async function criarTarefa(
  userId: string,
  input: TarefaInput,
  confirmMessageId?: string
): Promise<Result> {
  const supabase = createServiceClient();

  // Idempotência: mesma source_message_id => mesma tarefa
  if (input.source_message_id) {
    const { data: existente } = await supabase
      .from('tarefas')
      .select('*')
      .eq('user_id', userId)
      .eq('source', input.source ?? 'whatsapp')
      .eq('source_message_id', input.source_message_id)
      .maybeSingle();
    if (existente) {
      return {
        reply: `ℹ️ Essa tarefa já tinha sido registrada antes.`,
        ok: false,
        id: existente.id,
      };
    }
  }

  const { data: tarefa, error } = await supabase
    .from('tarefas')
    .insert({
      user_id: userId,
      texto_original: input.texto_original,
      titulo: input.titulo,
      descricao: input.descricao ?? null,
      data_prazo: input.data_prazo,
      hora_prazo: input.hora_prazo ?? null,
      tipo: input.tipo,
      categoria: input.categoria ?? null,
      prioridade: input.prioridade ?? 'media',
      recorrencia: input.recorrencia ?? null,
      source: input.source ?? 'manual',
      source_message_id: input.source_message_id ?? null,
      confirm_message_id: confirmMessageId ?? null,
    })
    .select()
    .single();

  if (error || !tarefa) {
    return { reply: `⚠️ Erro ao salvar tarefa: ${error?.message ?? 'desconhecido'}`, ok: false };
  }

  const lembrete_ids = await gerarLembretesIniciais(tarefa.id);

  const reply = formatarConfirmacaoTarefa(
    {
      titulo: tarefa.titulo,
      data_prazo: tarefa.data_prazo,
      hora_prazo: tarefa.hora_prazo,
      tipo: tarefa.tipo,
      recorrencia: tarefa.recorrencia,
    },
    lembrete_ids.map((id) => ({ motivo: 'aviso_previo' as const })) // placeholder, texto usa regra fixa
  );

  return { reply, ok: true, id: tarefa.id, lembrete_ids };
}

/**
 * Marca tarefa como concluída (idempotente) e cancela lembretes pendentes.
 * Retorna a reply curta que será enviada ao grupo.
 */
export async function concluirTarefa(userId: string, tarefaId: string): Promise<Result> {
  const supabase = createServiceClient();

  const { data: t, error: fetchErr } = await supabase
    .from('tarefas')
    .select('*')
    .eq('id', tarefaId)
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchErr || !t) return { reply: '🤷 Tarefa não encontrada.', ok: false };
  if (t.status === 'concluida') return { reply: `ℹ️ Tarefa "${t.titulo}" já estava concluída.`, ok: true, id: t.id };
  if (t.status === 'cancelada') return { reply: `ℹ️ Tarefa "${t.titulo}" foi cancelada.`, ok: false, id: t.id };

  const { error } = await supabase
    .from('tarefas')
    .update({ status: 'concluida', concluida_em: new Date().toISOString() })
    .eq('id', tarefaId)
    .eq('user_id', userId);

  if (error) return { reply: `⚠️ Erro: ${error.message}`, ok: false };

  await cancelarLembretesPendente(tarefaId, 'tarefa concluída');

  return { reply: `✅ Tarefa "${t.titulo}" concluída! Lembretes cancelados.`, ok: true, id: tarefaId };
}

/**
 * Busca tarefa cujo título contenha o trecho (case-insensitive) entre as
 * pendentes. Se houver mais de uma, devolve a mais recente. Se não houver,
 * devolve ok:false. Usado pelo caminho "concluí X" via WhatsApp.
 */
export async function concluirTarefaPorTexto(
  userId: string,
  trecho: string
): Promise<Result> {
  const supabase = createServiceClient();
  const termo = trecho.trim();
  if (!termo) return { reply: '🤷 Qual tarefa? Manda "concluí <trecho do título>".', ok: false };

  const { data: candidatas } = await supabase
    .from('tarefas')
    .select('id, titulo')
    .eq('user_id', userId)
    .eq('status', 'pendente')
    .ilike('titulo', `%${termo}%`)
    .order('created_at', { ascending: false })
    .limit(5);

  if (!candidatas || candidatas.length === 0) {
    return { reply: `🤷 Nenhuma tarefa pendente casa com "${termo}".`, ok: false };
  }
  if (candidatas.length > 1) {
    const lista = candidatas.map((c) => `• ${c.titulo}`).join('\n');
    return {
      reply: `Achei mais de uma:\n${lista}\n\nQual? Responde com mais detalhe.`,
      ok: false,
    };
  }
  return await concluirTarefa(userId, candidatas[0].id);
}

/**
 * Handler de reação ✅ no WhatsApp. Recebe o id da msg que recebeu a
 * reação e marca a tarefa correspondente como concluída.
 *
 * #5: além do match direto por confirm_message_id, tenta casar via
 * lastBotMessageId da sessão do user — permite que o bot confirme
 * mensagens sem ter esperado o id da Evolution (ex: mensagens com
 * dedup confirm, msgs de consulta, msgs de ação).
 */
export async function concluirPorReaction(
  reactedMessageId: string,
  ctx?: { userId?: string; remoteJid?: string; instanceName?: string }
): Promise<Result> {
  const supabase = createServiceClient();

  // 1) Match direto no confirm_message_id (caminho canônico)
  const { data: t } = await supabase
    .from('tarefas')
    .select('id, user_id, titulo')
    .eq('confirm_message_id', reactedMessageId)
    .eq('status', 'pendente')
    .maybeSingle();

  if (t) return await concluirTarefa(t.user_id, t.id);

  // 2) Match via sessão: se a msg reativa é a última msg do bot na
  // sessão do user e essa sessão referenciava uma tarefa (ex: criada
  // minutos atrás pelo mesmo user), conclui ela.
  if (ctx?.userId && ctx?.remoteJid && ctx?.instanceName) {
    const { getSession } = await import('@/lib/whatsapp/session');
    const sess = await getSession(ctx.userId, ctx.remoteJid, ctx.instanceName);
    if (sess.lastBotMessageId === reactedMessageId && sess.lastCreatedTarefaId) {
      return await concluirTarefa(ctx.userId, sess.lastCreatedTarefaId);
    }
  }

  return { reply: '', ok: false };
}

/**
 * Lista tarefas do user, com filtro opcional.
 */
export async function listarTarefas(
  userId: string,
  opts: { status?: 'pendente' | 'concluida' | 'cancelada' | 'todas'; limite?: number } = {}
): Promise<Tarefa[]> {
  const supabase = createServiceClient();
  let q = supabase
    .from('tarefas')
    .select('*')
    .eq('user_id', userId)
    .order('status', { ascending: true }) // pendente < concluida < cancelada em ASCII? Não.
    .order('data_prazo', { ascending: true, nullsFirst: false })
    .limit(opts.limite ?? 200);

  if (opts.status && opts.status !== 'todas') q = q.eq('status', opts.status);

  const { data } = await q;
  return (data ?? []) as Tarefa[];
}

/**
 * Edita tarefa (campos opcionais). Se data_prazo/hora_prazo mudar,
 * regenera os 2 lembretes iniciais.
 */
export async function editarTarefa(
  userId: string,
  tarefaId: string,
  patch: Partial<{
    titulo: string;
    descricao: string | null;
    data_prazo: string;
    hora_prazo: string | null;
    categoria: string | null;
    prioridade: TaskPriority;
    recorrencia: 'semanal' | 'mensal' | null;
  }>
): Promise<Result> {
  const supabase = createServiceClient();

  // Buscar tarefa atual pra saber se data/hora mudou
  const { data: atual } = await supabase
    .from('tarefas')
    .select('data_prazo, hora_prazo, tipo')
    .eq('id', tarefaId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!atual) return { reply: '🤷 Tarefa não encontrada.', ok: false };

  const dataMudou =
    (patch.data_prazo && patch.data_prazo !== atual.data_prazo) ||
    ('hora_prazo' in patch && patch.hora_prazo !== atual.hora_prazo);

  const { error } = await supabase
    .from('tarefas')
    .update(patch)
    .eq('id', tarefaId)
    .eq('user_id', userId);

  if (error) return { reply: `⚠️ Erro: ${error.message}`, ok: false };

  if (dataMudou) {
    await cancelarLembretesPendente(tarefaId, 'tarefa editada');
    await gerarLembretesIniciais(tarefaId);
  }

  return { reply: '✅ Tarefa atualizada.', ok: true, id: tarefaId };
}

/**
 * Marca como cancelada (status='cancelada') e cancela lembretes pendentes.
 * Não deleta — preserva histórico.
 */
export async function cancelarTarefa(userId: string, tarefaId: string): Promise<Result> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from('tarefas')
    .update({ status: 'cancelada' })
    .eq('id', tarefaId)
    .eq('user_id', userId);

  if (error) return { reply: `⚠️ Erro: ${error.message}`, ok: false };

  await cancelarLembretesPendente(tarefaId, 'tarefa cancelada');
  return { reply: '🗑️ Tarefa cancelada.', ok: true, id: tarefaId };
}

/**
 * Hard delete. Cascade apaga lembretes_agendados via FK.
 */
export async function deletarTarefa(userId: string, tarefaId: string): Promise<Result> {
  const supabase = createServiceClient();
  const { error } = await supabase.from('tarefas').delete().eq('id', tarefaId).eq('user_id', userId);
  if (error) return { reply: `⚠️ Erro: ${error.message}`, ok: false };
  return { reply: '🗑️ Tarefa apagada.', ok: true, id: tarefaId };
}
