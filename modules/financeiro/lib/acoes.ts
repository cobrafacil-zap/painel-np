/**
 * Ações destrutivas chamadas pelo webhook WhatsApp.
 * Por enquanto: apagar último lançamento / apagar por categoria.
 *
 * #5: Apaga com snapshot pra undo (responder "desfazer"). Apagar em massa
 * (>3 registros) pede confirmação prévia.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { formatBRL } from '@/lib/utils';
import { setContext } from '@/lib/whatsapp/session';

export type AcaoResult = {
  reply: string;
  deleted?: number;
  /** Quando a ação fica pendente de confirmação (não executou ainda). */
  pendingConfirm?: {
    acao: 'apagar_categoria';
    alvo: string;
    count: number;
    totalAmount: number;
  };
};

export async function executarAcao(
  userId: string,
  acao: 'apagar_ultimo' | 'apagar_categoria' | 'pagar_parcela' | 'pagar_conta',
  alvo: string | null,
  ctx?: { remoteJid?: string; instanceName?: string }
): Promise<AcaoResult> {
  const supabase = createServiceClient();

  if (acao === 'apagar_ultimo') {
    const { data: last, error: fetchErr } = await supabase
      .from('records')
      .select('id, type, amount, category, description, occurred_at, payment_method, module_id, source')
      .eq('user_id', userId)
      .eq('module_id', 'financeiro')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchErr) return { reply: `⚠️ Erro ao buscar: ${fetchErr.message}` };
    if (!last) return { reply: '🤷 Nenhum lançamento pra apagar.' };

    const { error: delErr } = await supabase
      .from('records')
      .delete()
      .eq('id', last.id)
      .eq('user_id', userId);

    if (delErr) return { reply: `⚠️ Erro ao apagar: ${delErr.message}` };

    const sinal = last.type === 'gasto' ? '−' : '+';
    const desc = last.description || last.category || 'sem descrição';

    // Salva snapshot pra undo (#5)
    if (ctx?.remoteJid && ctx?.instanceName) {
      const { id: _id, ...rest } = last as any;
      void setContext(userId, ctx.remoteJid, ctx.instanceName, {
        lastDeletedRecord: {
          record: rest,
          ts: new Date().toISOString(),
        },
      });
    }

    return {
      reply: `🗑️ Apagado: ${last.type} de ${sinal}${formatBRL(Number(last.amount))} (${desc}).\nSe arrependeu, responde "desfazer" em 30min.`,
      deleted: 1,
    };
  }

  if (acao === 'apagar_categoria') {
    if (!alvo) {
      return { reply: '🤔 Falta dizer qual categoria apagar. Ex: "apagar tudo do posto".' };
    }

    // Conta quantos e soma valores
    const { data: rows } = await supabase
      .from('records')
      .select('amount')
      .eq('user_id', userId)
      .eq('module_id', 'financeiro')
      .eq('category', alvo);

    const count = rows?.length ?? 0;
    const totalAmount = (rows ?? []).reduce((s, r) => s + Number(r.amount), 0);

    if (count === 0) {
      return { reply: `🤷 Nenhum lançamento encontrado na categoria "${alvo}".` };
    }

    // Se for delete em massa (>3), pede confirmação (#5)
    if (count > 3 && ctx?.remoteJid && ctx?.instanceName) {
      await setContext(userId, ctx.remoteJid, ctx.instanceName, {
        pendingPrompt: {
          kind: 'delete_confirm',
          promptMessageId: '',
          payload: {
            acao: 'apagar_categoria',
            alvo,
            count,
            totalAmount,
          },
          ts: new Date().toISOString(),
        },
      });
      return {
        reply: `⚠️ Vou apagar ${count} registros de "${alvo}" totalizando ${formatBRL(totalAmount)}.\n\nConfirma? Responde "sim" pra apagar ou "não" pra cancelar.`,
        pendingConfirm: {
          acao: 'apagar_categoria',
          alvo,
          count,
          totalAmount,
        },
      };
    }

    // Poucos registros: apaga direto, mas salva snapshots pra undo em batch
    const { data: toDelete } = await supabase
      .from('records')
      .select('id, type, amount, category, description, occurred_at, payment_method, module_id, source')
      .eq('user_id', userId)
      .eq('module_id', 'financeiro')
      .eq('category', alvo);

    const { error: delErr } = await supabase
      .from('records')
      .delete()
      .eq('user_id', userId)
      .eq('module_id', 'financeiro')
      .eq('category', alvo);

    if (delErr) return { reply: `⚠️ Erro ao apagar: ${delErr.message}` };

    if (ctx?.remoteJid && ctx?.instanceName && toDelete && toDelete.length > 0) {
      const snapshots = toDelete.map(({ id: _id, ...rest }) => rest);
      await setContext(userId, ctx.remoteJid, ctx.instanceName, {
        pendingPrompt: {
          kind: 'undo_delete',
          promptMessageId: '',
          payload: { snapshots },
          ts: new Date().toISOString(),
        },
      });
    }

    return {
      reply: `🗑️ ${count} lançamento${count > 1 ? 's' : ''} da categoria "${alvo}" apagado${count > 1 ? 's' : ''}.\nSe arrependeu, responde "desfazer" em 30min.`,
      deleted: count,
    };
  }

  return { reply: '🤔 Ação não reconhecida.' };
}
