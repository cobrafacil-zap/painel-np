/**
 * Meta diária de gastos (#extra) — limite por dia + avisos progressivos.
 *
 * Persiste em `user_settings.meta_diaria` (1 linha por user).
 * O relatório diário (cron 17h/23h) consulta e adiciona indicador
 * (🟢 ok / 🟡 perto / 🔴 estourou). Aviso extra de 80%/100% pode
 * ser disparado pelo webhook em cada gasto (ver checarMetaDiaria).
 */

import { createServiceClient } from '@/lib/supabase/server';
import { formatBRL, todayISO } from '@/lib/utils';

export type MetaDiariaResult = {
  reply: string;
  ok: boolean;
};

export async function setMetaDiaria(
  userId: string,
  amount: number,
): Promise<MetaDiariaResult> {
  if (!Number.isFinite(amount) || amount < 0) {
    return { reply: '🤔 Valor inválido pra meta diária.', ok: false };
  }
  const supabase = createServiceClient();
  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: userId, meta_diaria: amount, updated_at: new Date().toISOString() });
  if (error) {
    return { reply: `⚠️ Erro ao salvar meta: ${error.message}`, ok: false };
  }
  return {
    reply: `✅ Meta diária definida: ${formatBRL(amount)}/dia.`,
    ok: true,
  };
}

export async function getMetaDiaria(userId: string): Promise<number | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('user_settings')
    .select('meta_diaria')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.meta_diaria != null ? Number(data.meta_diaria) : null;
}

export async function deleteMetaDiaria(userId: string): Promise<MetaDiariaResult> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from('user_settings')
    .update({ meta_diaria: null, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) {
    return { reply: `⚠️ Erro ao remover meta: ${error.message}`, ok: false };
  }
  return { reply: '🗑️ Meta diária removida.', ok: true };
}

/**
 * Calcula o total gasto hoje pelo user.
 */
export async function getGastoHoje(userId: string): Promise<number> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('records')
    .select('amount')
    .eq('user_id', userId)
    .eq('module_id', 'financeiro')
    .eq('type', 'gasto')
    .eq('occurred_at', todayISO());
  return (data ?? []).reduce((s, r) => s + Number(r.amount), 0);
}

/**
 * Formata indicador visual da meta: 🟢 / 🟡 / 🔴 + % + status.
 */
export function formatarIndicadorMeta(meta: number, gasto: number): string {
  const pct = meta > 0 ? Math.round((gasto / meta) * 100) : 0;
  if (pct > 100) return `🔴 Estourou em ${formatBRL(gasto - meta)} (${pct}% da meta de ${formatBRL(meta)})`;
  if (pct >= 80) return `🟡 Atenção: ${pct}% da meta (${formatBRL(gasto)} de ${formatBRL(meta)})`;
  return `🟢 ${pct}% da meta (${formatBRL(gasto)} de ${formatBRL(meta)})`;
}

/**
 * Checa se um gasto recém-registrado deve disparar aviso de meta.
 * Retorna a mensagem de aviso ou null. Chamado pelo webhook em cada
 * INSERT de gasto (após dedup check).
 *
 * Não dispara 2x no mesmo dia pro mesmo limite (90% / 100%).
 */
export async function checarAvisoMetaDiaria(
  userId: string,
  remoteJid: string,
  instanceName: string | undefined,
): Promise<string | null> {
  const meta = await getMetaDiaria(userId);
  if (!meta || meta <= 0) return null;

  const gasto = await getGastoHoje(userId);
  const pct = (gasto / meta) * 100;

  // Só dispara se cruzou 80% ou 100% HOJE pela primeira vez
  const supabase = createServiceClient();
  const { setContext, getSession } = await import('@/lib/whatsapp/session');
  const sess = await getSession(userId, remoteJid, instanceName ?? '');
  const jaAvisou = (sess as any).metaDiariaAvisada ?? null;

  if (pct >= 100 && jaAvisou !== '100') {
    await setContext(userId, remoteJid, instanceName ?? '', {
      metaDiariaAvisada: '100',
    } as any);
    return (
      `🔴 *Meta diária estourou!*\n` +
      `Gasto hoje: ${formatBRL(gasto)} (${Math.round(pct)}% da meta de ${formatBRL(meta)})`
    );
  }
  if (pct >= 80 && pct < 100 && jaAvisou !== '80' && jaAvisou !== '100') {
    await setContext(userId, remoteJid, instanceName ?? '', {
      metaDiariaAvisada: '80',
    } as any);
    return (
      `🟡 *Atenção: perto da meta diária.*\n` +
      `Gasto ${Math.round(pct)}% (${formatBRL(gasto)} de ${formatBRL(meta)}).`
    );
  }
  return null;
}
