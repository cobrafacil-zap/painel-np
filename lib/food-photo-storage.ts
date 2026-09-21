/**
 * Storage + persistência de fotos de comida (#feature alimentação).
 *
 * Pipeline (espelha lib/audio-storage.ts):
 *   1. `uploadFoodPhoto(base64, mime, userId, messageId)` — sobe foto pro
 *      Supabase Storage em `food-photos/{user_id}/{message_id}.{ext}`.
 *   2. `saveFoodPhotoMessage(...)` — INSERT inicial em `messages` com
 *      type='image', image_storage_path=path.
 *      Idempotente via UNIQUE (user_id, message_id_whatsapp).
 *   3. `saveRefeicao(...)` — INSERT em `refeicoes` com macros extraídos.
 *   4. `listFoodPhotos({userId, limit, offset})` — query paginada.
 *   5. `getFoodPhotoSignedUrl(storagePath, ttl=86400)` — signed URL 24h.
 *   6. `cleanupOldFoodPhotos(retentionDays=60)` — apaga fotos antigas.
 *
 * Diferenças vs áudio:
 *   - Cap maior (5MB vs 1MB): foto de comida tem mais detalhe que
 *     importa pra reconhecimento (porção, molho, guarnição).
 *   - Retenção menor (60d vs 90d): foto é maior em bytes, vale menos
 *     depois de processada.
 *   - Não há transcrição. O conteúdo é a tabela `refeicoes` 1:1.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { logStage, logError } from './log';

const BUCKET = 'food-photos';
const SIGNED_URL_TTL_S = 60 * 60 * 24; // 24h
// 5MB é o cap default do Vercel Function request body. Foto de comida
// raramente chega a isso (WhatsApp re-comprime pra ~100-200KB); o cap
// existe pra defesa em profundidade.
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function extFromMime(mime: string | undefined | null): string {
  if (!mime) return 'jpg';
  return MIME_TO_EXT[mime.toLowerCase()] ?? 'jpg';
}

export type UploadFoodPhotoResult =
  | { storage_path: string; mime_type: string; file_size_bytes: number; skipped?: false }
  | { skipped: true; reason: 'too_big' | 'empty' | 'not_image'; file_size_bytes: number }
  | null;

/**
 * Sobe a foto pro Storage. Retorna path ou null em erro.
 * Path segue padrão `food-photos/{user_id}/{message_id}.{ext}` —
 * particionado por user pra RLS funcionar com `foldername(name)[1]`.
 */
export async function uploadFoodPhoto(
  base64: string,
  mimeType: string | null | undefined,
  userId: string,
  messageId: string,
): Promise<UploadFoodPhotoResult> {
  try {
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.byteLength === 0) {
      logError('food_photo_upload_empty', new Error('base64 vazio'), { userId });
      return { skipped: true, reason: 'empty', file_size_bytes: 0 };
    }
    if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
      logError('food_photo_upload_too_big', new Error(`>${MAX_FILE_SIZE_BYTES} bytes`), {
        size: buffer.byteLength,
      });
      return { skipped: true, reason: 'too_big', file_size_bytes: buffer.byteLength };
    }

    // WhatsApp sempre manda JPEG, mas validamos MIME pra rejeitar
    // arquivos que não sejam imagem (vídeo, sticker, doc).
    if (mimeType && !mimeType.toLowerCase().startsWith('image/')) {
      return { skipped: true, reason: 'not_image', file_size_bytes: buffer.byteLength };
    }

    const ext = extFromMime(mimeType);
    const path = `${userId}/${messageId}.${ext}`;
    const mime = mimeType ?? 'image/jpeg';

    const supabase = createServiceClient();
    const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType: mime,
      upsert: true, // idempotente contra reentregas da Evolution
    });

    if (error) {
      logError('food_photo_storage_upload', error, { path });
      return null;
    }

    return {
      storage_path: path,
      mime_type: mime,
      file_size_bytes: buffer.byteLength,
    };
  } catch (e) {
    logError('food_photo_upload', e);
    return null;
  }
}

/**
 * INSERT inicial em `messages` com type='image'. Idempotente via
 * UNIQUE (user_id, message_id_whatsapp).
 *
 * Reusa a estrutura monolítica da migration 016 — `image_storage_path`
 * foi adicionado em migration 018 coluna nova.
 */
export async function saveFoodPhotoMessage(params: {
  userId: string;
  messageIdWhatsapp: string;
  remoteJid: string;
  instanceName: string | null;
  storagePath: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
}): Promise<{ id: string; created: boolean } | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('messages')
      .insert({
        user_id: params.userId,
        message_id_whatsapp: params.messageIdWhatsapp,
        remote_jid: params.remoteJid,
        instance_name: params.instanceName,
        type: 'image',
        image_storage_path: params.storagePath,
        mime_type: params.mimeType,
        file_size_bytes: params.fileSizeBytes,
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

    logError('food_photo_message_save', error, { path: params.storagePath });
    return null;
  } catch (e) {
    logError('food_photo_message_save', e);
    return null;
  }
}

export interface RefeicaoData {
  kcal: number | null;
  protein_g: number | null;
  carb_g: number | null;
  fat_g: number | null;
  portion_g: number | null;
  meal_type: 'cafe' | 'almoco' | 'jantar' | 'lanche' | null;
  confidence: number | null;
  ai_model: string;
  descricao_user: string | null;
  itens: Array<{ nome: string; gramas: number; kcal: number; prot: number; carb: number; gord: number }>;
}

/**
 * INSERT em `refeicoes` com macros extraídos. 1:1 com messages.id.
 * Idempotente via UNIQUE (message_id) — se a foto já foi analisada
 * (reentrega da Evolution), retorna o id existente.
 */
export async function saveRefeicao(params: {
  userId: string;
  messageId: string;
  data: RefeicaoData;
}): Promise<{ id: string; created: boolean } | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('refeicoes')
      .insert({
        user_id: params.userId,
        message_id: params.messageId,
        kcal: params.data.kcal,
        protein_g: params.data.protein_g,
        carb_g: params.data.carb_g,
        fat_g: params.data.fat_g,
        portion_g: params.data.portion_g,
        meal_type: params.data.meal_type,
        confidence: params.data.confidence,
        ai_model: params.data.ai_model,
        descricao_user: params.data.descricao_user,
        itens: params.data.itens,
      })
      .select('id')
      .single();

    if (!error && data) {
      return { id: data.id as string, created: true };
    }

    if (error && (error as { code?: string }).code === '23505') {
      const { data: existing } = await supabase
        .from('refeicoes')
        .select('id')
        .eq('message_id', params.messageId)
        .maybeSingle();
      if (existing) return { id: existing.id, created: false };
    }

    logError('refeicao_save', error, { messageId: params.messageId });
    return null;
  } catch (e) {
    logError('refeicao_save', e);
    return null;
  }
}

export interface RefeicaoListItem {
  id: string;
  message_id: string;
  occurred_at: string;
  meal_type: string | null;
  kcal: number | null;
  protein_g: number | null;
  carb_g: number | null;
  fat_g: number | null;
  portion_g: number | null;
  confidence: number | null;
  descricao_user: string | null;
  itens: Array<{ nome: string; gramas: number; kcal: number; prot: number; carb: number; gord: number }>;
  image_storage_path: string | null;
  signed_url: string | null;
}

/**
 * Lista refeições do user com paginação. Gera signed URL 24h pra cada
 * foto (após cleanup de 60d, signed_url=null).
 */
export async function listRefeicoes(params: {
  userId: string;
  limit?: number;
  offset?: number;
  mealType?: 'cafe' | 'almoco' | 'jantar' | 'lanche' | null;
}): Promise<{ items: RefeicaoListItem[]; total: number }> {
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const offset = Math.max(params.offset ?? 0, 0);

  const supabase = createServiceClient();
  let query = supabase
    .from('refeicoes')
    .select(
      `id, message_id, occurred_at, meal_type, kcal, protein_g, carb_g, fat_g, portion_g,
       confidence, descricao_user, itens, ativa,
       messages!inner(image_storage_path)`,
      { count: 'exact' },
    )
    .eq('user_id', params.userId)
    .eq('ativa', true)
    .order('occurred_at', { ascending: false });

  if (params.mealType) {
    query = query.eq('meal_type', params.mealType);
  }

  const { data, count } = await query.range(offset, offset + limit - 1);

  const items: RefeicaoListItem[] = [];
  for (const row of (data ?? []) as Array<any>) {
    const storagePath = row.messages?.image_storage_path as string | null;
    let signed_url: string | null = null;
    if (storagePath) {
      try {
        const { data: signed } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(storagePath, SIGNED_URL_TTL_S);
        signed_url = signed?.signedUrl ?? null;
      } catch {
        signed_url = null;
      }
    }
    items.push({
      id: row.id,
      message_id: row.message_id,
      occurred_at: row.occurred_at,
      meal_type: row.meal_type,
      kcal: row.kcal,
      protein_g: row.protein_g,
      carb_g: row.carb_g,
      fat_g: row.fat_g,
      portion_g: row.portion_g,
      confidence: row.confidence,
      descricao_user: row.descricao_user,
      itens: row.itens ?? [],
      image_storage_path: storagePath,
      signed_url,
    });
  }

  return { items, total: count ?? items.length };
}

/** Signed URL direta pra um path (renovação on-click). */
export async function getFoodPhotoSignedUrl(
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
 * Cleanup: apaga fotos com >60 dias no Storage. Mantém row em
 * `messages` (image_storage_path=null) e `refeicoes` (macros preservados).
 *
 * Roda via cron consolidado `disparar-lembretes` (Free plan limit).
 */
export async function cleanupOldFoodPhotos(
  retentionDays: number = 60,
): Promise<{ arquivosApagados: number; rowsAtualizadas: number }> {
  try {
    const supabase = createServiceClient();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: antigas } = await supabase
      .from('messages')
      .select('id, image_storage_path')
      .eq('type', 'image')
      .not('image_storage_path', 'is', null)
      .lt('occurred_at', cutoff);

    if (!antigas || antigas.length === 0) {
      return { arquivosApagados: 0, rowsAtualizadas: 0 };
    }

    const paths = antigas.map((a) => a.image_storage_path!).filter(Boolean);
    let arquivosApagados = 0;
    if (paths.length > 0) {
      const { data: removed } = await supabase.storage.from(BUCKET).remove(paths);
      arquivosApagados = removed?.length ?? 0;
    }

    const ids = antigas.map((a) => a.id);
    const { error: updateErr } = await supabase
      .from('messages')
      .update({ image_storage_path: null })
      .in('id', ids);

    if (updateErr) {
      logError('food_photo_cleanup_update', updateErr);
    }

    logStage('food_photo_cleanup_done', undefined, {
      arquivosApagados,
      rowsAtualizadas: ids.length,
      cutoff,
    });

    return { arquivosApagados, rowsAtualizadas: ids.length };
  } catch (e) {
    logError('food_photo_cleanup', e);
    return { arquivosApagados: 0, rowsAtualizadas: 0 };
  }
}
