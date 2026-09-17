/**
 * Ações destrutivas chamadas pelo webhook WhatsApp.
 * Por enquanto: apagar último lançamento / apagar por categoria.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { formatBRL } from '@/lib/utils';

export type AcaoResult = {
  reply: string;
  deleted?: number;
};

export async function executarAcao(
  userId: string,
  acao: 'apagar_ultimo' | 'apagar_categoria' | 'pagar_parcela' | 'pagar_conta',
  alvo: string | null
): Promise<AcaoResult> {
  const supabase = createServiceClient();

  if (acao === 'apagar_ultimo') {
    const { data: last, error: fetchErr } = await supabase
      .from('records')
      .select('id, type, amount, category, description, occurred_at')
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
    return {
      reply: `🗑️ Apagado: ${last.type} de ${sinal}${formatBRL(Number(last.amount))} (${desc})`,
      deleted: 1,
    };
  }

  if (acao === 'apagar_categoria') {
    if (!alvo) {
      return { reply: '🤔 Falta dizer qual categoria apagar. Ex: "apagar tudo do posto".' };
    }
    // Confirma o que vai apagar antes (count)
    const { count } = await supabase
      .from('records')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('module_id', 'financeiro')
      .eq('category', alvo);

    if (!count || count === 0) {
      return { reply: `🤷 Nenhum lançamento encontrado na categoria "${alvo}".` };
    }

    // Apaga todos os lançamentos dessa categoria
    const { error: delErr } = await supabase
      .from('records')
      .delete()
      .eq('user_id', userId)
      .eq('module_id', 'financeiro')
      .eq('category', alvo);

    if (delErr) return { reply: `⚠️ Erro ao apagar: ${delErr.message}` };

    return {
      reply: `🗑️ ${count} lançamento${count > 1 ? 's' : ''} da categoria "${alvo}" apagado${count > 1 ? 's' : ''}.`,
      deleted: count,
    };
  }

  return { reply: '🤔 Ação não reconhecida.' };
}
