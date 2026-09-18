/**
 * Sessão por usuário + remote_jid — guarda contexto entre mensagens.
 *
 * Usado pra:
 * - #2 Follow-up: "e mês passado?" lembra qual era a última query
 * - #3 Dedup: aguardar confirmação ("sim outro" / "não é o mesmo")
 * - #5 Undo: snapshot do último registro deletado (responder "desfazer")
 *
 * TTL implícito: 30 minutos. Context é apagado no `getContext` se
 * `last_message_at < now - 30min`.
 */

import { createServiceClient } from '@/lib/supabase/server';

const TTL_MS = 30 * 60 * 1000;

export interface SessionContext {
  // Última consulta feita (pra follow-up "e mês passado?")
  lastQuery?: {
    tipo: 'saldo' | 'gastos' | 'receitas' | 'top_categoria' | 'compromissos' | 'parcelas';
    periodo: 'hoje' | 'semana' | 'mes' | 'mes_passado' | 'tudo';
    categoria: string | null;
    categoriaLabel: string | null;
    ts: string;
  };
  // ID da última msg que o bot mandou pra esse JID (pra reaction ✅)
  lastBotMessageId?: string;
  // ID da última tarefa criada pelo bot (#5 — reaction contextual)
  lastCreatedTarefaId?: string;
  // Última pergunta pendente esperando confirmação
  // (dedup: "isso parece duplicata, confirma?" | undo: "apaguei X, responde 'desfazer'")
  pendingPrompt?: {
    kind: 'dedup_confirm' | 'delete_confirm' | 'undo_delete';
    promptMessageId: string;
    // payload da ação pendente
    payload: Record<string, unknown>;
    ts: string;
  };
  // Snapshot do último record deletado (pra "desfazer")
  // - apagar_ultimo → record único
  // - apagar_categoria → snapshots[] em batch
  lastDeletedRecord?: {
    record?: Record<string, unknown> | null;
    snapshots?: Array<Record<string, unknown>>;
    ts: string;
  };
  // Permite extensão por outras features
  [key: string]: unknown;
}

export async function getSession(
  userId: string,
  remoteJid: string,
  instanceName: string
): Promise<SessionContext> {
  const supabase = createServiceClient();

  // Lê sessão atual
  const { data } = await supabase
    .from('whatsapp_sessions')
    .select('context, last_message_at')
    .eq('user_id', userId)
    .eq('remote_jid', remoteJid)
    .maybeSingle();

  if (!data) return {};

  // Expira contexto se passou do TTL
  const last = data.last_message_at ? new Date(data.last_message_at).getTime() : 0;
  if (Date.now() - last > TTL_MS) {
    return {};
  }

  return (data.context as SessionContext) ?? {};
}

export async function setContext(
  userId: string,
  remoteJid: string,
  instanceName: string,
  patch: Partial<SessionContext>,
  options?: { touchLastMessage?: boolean }
): Promise<void> {
  const supabase = createServiceClient();

  // Lê atual (sem aplicar TTL — pode querer estender contexto antes de expirar)
  const { data: existing } = await supabase
    .from('whatsapp_sessions')
    .select('context, instance_name, last_message_at')
    .eq('user_id', userId)
    .eq('remote_jid', remoteJid)
    .maybeSingle();

  const current = (existing?.context as SessionContext) ?? {};
  const merged: SessionContext = { ...current, ...patch };

  const now = new Date().toISOString();
  const row = {
    user_id: userId,
    remote_jid: remoteJid,
    instance_name: existing?.instance_name ?? instanceName,
    context: merged,
    last_message_at: options?.touchLastMessage === false ? (existing?.last_message_at ?? now) : now,
    updated_at: now,
  };

  const { error } = await supabase
    .from('whatsapp_sessions')
    .upsert(row, { onConflict: 'user_id,remote_jid' });

  if (error) {
    console.warn('[session] upsert falhou:', error.message);
  }
}

export async function clearContext(
  userId: string,
  remoteJid: string,
  instanceName: string
): Promise<void> {
  await setContext(userId, remoteJid, instanceName, {
    lastQuery: undefined,
    pendingPrompt: undefined,
    lastDeletedRecord: undefined,
    lastBotMessageId: undefined,
    lastCreatedTarefaId: undefined,
  } as Partial<SessionContext>);
}
