/**
 * Storage + persistência de mensagens do WhatsApp (#overhaul audio).
 *
 * Pipeline:
 *   1. `uploadAudio(base64, mime, userId, messageId)` — sobe o arquivo
 *      pro Supabase Storage em `audios/{user_id}/{message_id}.{ext}`.
 *   2. `saveAudioMessage(...)` — INSERT inicial em `messages` com
 *      type='audio', transcription=null, audio_storage_path=path.
 *      Idempotente via UNIQUE (user_id, message_id_whatsapp).
 *   3. `updateTranscription(messageId, transcription, confidence)` —
 *      preenche transcrição após Whisper.
 *   4. `updateSummary(messageId, summary, topics, entities)` —
 *      preenche sumário após Groq llama.
 *   5. `listAudios({userId, limit, offset, search, topic})` — query
 *      paginada com FTS opcional.
 *   6. `getAudioSignedUrl(storagePath, ttl=86400)` — signed URL 24h.
 *
 * Tudo via service role (não passa pelo RLS do user). Caller valida
 * `userId` antes de chamar (vem de `auth.uid()` no webhook).
 */

import { createServiceClient } from '@/lib/supabase/server';
import { logStage, logError } from './log';

const BUCKET = 'audios';
const SIGNED_URL_TTL_S = 60 * 60 * 24; // 24h
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB — Whisper aceita até 25MB mas o WhatsApp raramente passa de 2MB

const MIME_TO_EXT: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/ogg; codecs=opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/aac': 'aac',
};

function extFromMime(mime: string | undefined | null): string {
  if (!mime) return 'ogg';
  return MIME_TO_EXT[mime.toLowerCase()] ?? 'ogg';
}

/**
 * Sobe o áudio pro Storage. Retorna path ou null em erro.
 * Path segue padrão `audios/{user_id}/{message_id}.{ext}` — particionado
 * por user pra RLS funcionar com `foldername(name)[1] = auth.uid()`.
 */
export async function uploadAudio(
  base64: string,
  mimeType: string | null | undefined,
  userId: string,
  messageId: string,
): Promise<{
  storage_path: string;
  mime_type: string;
  file_size_bytes: number;
} | null> {
  try {
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.byteLength === 0) {
      logError('audio_upload_empty', new Error('base64 vazio'), { userId });
      return null;
    }
    if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
      logError('audio_upload_too_big', new Error(`>${MAX_FILE_SIZE_BYTES} bytes`), {
        size: buffer.byteLength,
      });
      return null;
    }

    const ext = extFromMime(mimeType);
    const path = `${userId}/${messageId}.${ext}`;
    const mime = mimeType ?? 'audio/ogg';

    const supabase = createServiceClient();
    const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType: mime,
      upsert: true, // idempotente contra reentregas da Evolution
    });

    if (error) {
      logError('audio_storage_upload', error, { path });
      return null;
    }

    return {
      storage_path: path,
      mime_type: mime,
      file_size_bytes: buffer.byteLength,
    };
  } catch (e) {
    logError('audio_upload', e);
    return null;
  }
}

/**
 * INSERT inicial em `messages` com type='audio'. Idempotente via
 * ON CONFLICT DO NOTHING — se a msg já existe (reentrega da Evolution),
 * retorna o id existente sem erro.
 */
export async function saveAudioMessage(params: {
  userId: string;
  messageIdWhatsapp: string;
  remoteJid: string;
  instanceName: string | null;
  storagePath: string;
  mimeType: string;
  fileSizeBytes: number;
  durationSeconds: number | null;
}): Promise<{ id: string; created: boolean } | null> {
  try {
    const supabase = createServiceClient();
    // Estratégia: tenta INSERT; se der conflito de UNIQUE (código 23505),
    // faz SELECT pra retornar o id existente. Mais explícito que
    // `.upsert()` porque queremos distinguir `created=true` vs `false`.
    const { data, error } = await supabase
      .from('messages')
      .insert({
        user_id: params.userId,
        message_id_whatsapp: params.messageIdWhatsapp,
        remote_jid: params.remoteJid,
        instance_name: params.instanceName,
        type: 'audio',
        audio_storage_path: params.storagePath,
        mime_type: params.mimeType,
        file_size_bytes: params.fileSizeBytes,
        duration_seconds: params.durationSeconds,
      })
      .select('id')
      .single();

    if (!error && data) {
      return { id: data.id as string, created: true };
    }

    // 23505 = unique_violation. Refetch pra retornar o existente.
    if (error && (error as { code?: string }).code === '23505') {
      const { data: existing } = await supabase
        .from('messages')
        .select('id')
        .eq('user_id', params.userId)
        .eq('message_id_whatsapp', params.messageIdWhatsapp)
        .maybeSingle();
      if (existing) return { id: existing.id, created: false };
    }

    logError('audio_message_save', error, { path: params.storagePath });
    return null;
  } catch (e) {
    logError('audio_message_save', e);
    return null;
  }
}

/** Preenche transcrição + confidence após Whisper. */
export async function updateTranscription(
  messageId: string,
  transcription: string,
  confidence: number | null,
): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase
      .from('messages')
      .update({
        transcription,
        transcription_confidence: confidence,
      })
      .eq('id', messageId);
  } catch (e) {
    logError('audio_update_transcription', e, { messageId });
  }
}

/** Preenche sumário + tópicos + entidades após Groq llama. */
export async function updateSummary(
  messageId: string,
  summary: string,
  topics: string[],
  entities: { people: string[]; amounts: number[]; places: string[] },
): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase
      .from('messages')
      .update({
        ai_summary: summary,
        ai_topics: topics,
        ai_entities: entities,
      })
      .eq('id', messageId);
  } catch (e) {
    logError('audio_update_summary', e, { messageId });
  }
}

export interface AudioListItem {
  id: string;
  message_id_whatsapp: string;
  occurred_at: string;
  duration_seconds: number | null;
  mime_type: string | null;
  transcription: string | null;
  ai_summary: string | null;
  ai_topics: string[] | null;
  ai_entities: { people?: string[]; amounts?: number[]; places?: string[] } | null;
  audio_storage_path: string | null;
  signed_url: string | null;
}

export interface ListAudiosParams {
  userId: string;
  limit?: number;
  offset?: number;
  search?: string | null;
  topic?: string | null;
}

export interface ListAudiosResult {
  items: AudioListItem[];
  total: number;
}

/**
 * Lista áudios do user com paginação, busca (FTS PT-BR) e filtro por tópico.
 * Gera signed URL 24h pra cada áudio que ainda tem arquivo no Storage
 * (após cleanup de 90 dias, `audio_storage_path` é null).
 */
export async function listAudios(
  params: ListAudiosParams,
): Promise<ListAudiosResult> {
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const offset = Math.max(params.offset ?? 0, 0);

  const supabase = createServiceClient();
  let query = supabase
    .from('messages')
    .select(
      'id, message_id_whatsapp, occurred_at, duration_seconds, mime_type, transcription, ai_summary, ai_topics, ai_entities, audio_storage_path',
      { count: 'exact' },
    )
    .eq('user_id', params.userId)
    .eq('type', 'audio')
    .order('occurred_at', { ascending: false });

  // Busca por FTS PT-BR: usa a coluna `search_text` (gerada na
  // migration 016 como `transcription || ' ' || ai_summary`) com
  // `.textSearch()` em config `portuguese`. Planner usa o índice GIN
  // automaticamente.
  if (params.search && params.search.trim().length >= 2) {
    const safe = params.search.trim().slice(0, 200);
    if (safe) {
      query = query.textSearch('search_text', safe, {
        type: 'plain',
        config: 'portuguese',
      });
    }
  }

  if (params.topic && params.topic.trim().length > 0) {
    query = query.contains('ai_topics', [params.topic.trim().toLowerCase()]);
  }

  const { data, count } = await query.range(offset, offset + limit - 1);

  return await attachSignedUrlsAndCount(
    (data ?? []) as Array<Partial<AudioListItem>>,
    params,
    limit,
    offset,
    count ?? (data?.length ?? 0),
  );
}

async function attachSignedUrlsAndCount(
  rows: Array<Partial<AudioListItem>>,
  _params: ListAudiosParams,
  _limit: number,
  _offset: number,
  total?: number,
): Promise<ListAudiosResult> {
  const supabase = createServiceClient();
  const items: AudioListItem[] = [];

  for (const row of rows) {
    let signed_url: string | null = null;
    if (row.audio_storage_path) {
      try {
        const { data } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(row.audio_storage_path, SIGNED_URL_TTL_S);
        signed_url = data?.signedUrl ?? null;
      } catch {
        signed_url = null;
      }
    }
    items.push({
      id: row.id!,
      message_id_whatsapp: row.message_id_whatsapp!,
      occurred_at: row.occurred_at!,
      duration_seconds: row.duration_seconds ?? null,
      mime_type: row.mime_type ?? null,
      transcription: row.transcription ?? null,
      ai_summary: row.ai_summary ?? null,
      ai_topics: row.ai_topics ?? null,
      ai_entities: row.ai_entities ?? null,
      audio_storage_path: row.audio_storage_path ?? null,
      signed_url,
    });
  }

  return { items, total: total ?? items.length };
}

/** Signed URL direta pra um path específico (renovação on-click). */
export async function getAudioSignedUrl(
  storagePath: string,
  ttlSeconds: number = SIGNED_URL_TTL_S,
): Promise<string | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, ttlSeconds);
    if (error) return null;
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Cleanup: apaga arquivos com >90 dias no Storage. Mantém row em
 * `messages` mas zera `audio_storage_path` (transcrição+sumário
 * continuam acessíveis).
 *
 * Roda via cron `app/api/cron/cleanup-audios` (0 3 * * *).
 */
export async function cleanupOldAudios(retentionDays: number = 90): Promise<{
  arquivosApagados: number;
  rowsAtualizadas: number;
}> {
  try {
    const supabase = createServiceClient();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

    // Busca áudios com arquivo ainda presente E occurred_at < cutoff
    const { data: antigos } = await supabase
      .from('messages')
      .select('id, audio_storage_path')
      .eq('type', 'audio')
      .not('audio_storage_path', 'is', null)
      .lt('occurred_at', cutoff);

    if (!antigos || antigos.length === 0) {
      return { arquivosApagados: 0, rowsAtualizadas: 0 };
    }

    // Apaga do Storage em batch
    const paths = antigos.map((a) => a.audio_storage_path!).filter(Boolean);
    let arquivosApagados = 0;
    if (paths.length > 0) {
      const { data: removed } = await supabase.storage.from(BUCKET).remove(paths);
      arquivosApagados = removed?.length ?? 0;
    }

    // Zera audio_storage_path nas rows (preserva transcrição+sumário)
    const ids = antigos.map((a) => a.id);
    const { error: updateErr } = await supabase
      .from('messages')
      .update({ audio_storage_path: null })
      .in('id', ids);

    if (updateErr) {
      logError('cleanup_update', updateErr);
    }

    logStage('audio_cleanup_done', undefined, {
      arquivosApagados,
      rowsAtualizadas: ids.length,
      cutoff,
    });

    return { arquivosApagados, rowsAtualizadas: ids.length };
  } catch (e) {
    logError('audio_cleanup', e);
    return { arquivosApagados: 0, rowsAtualizadas: 0 };
  }
}
