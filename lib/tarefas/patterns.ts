/**
 * Memória de padrões do user pra tarefas (paralelo a `carregarPadroesParaContexto`
 * em `lib/financeiro/patterns.ts`).
 *
 * Lê view materializada `public.tarefa_patterns` (criada pela migration
 * 015) e injeta no system prompt do parser de tarefas. Com isso o Groq
 * passa a saber:
 *   - quais categorias o user mais usa (trabalho, pessoal, saude...)
 *   - quais dias da semana costuma criar tarefas
 *   - se tem tarefas recorrentes (lembrete de vencimento)
 *
 * View é atualizada pelo cron `calcular-padroes` (refresh CONCURRENTLY).
 */

import { createServiceClient } from '@/lib/supabase/server';

interface TarefaPattern {
  categoria: string;
  count: number;
  dia_semana_mais_comum: number | null;
  hora_mais_comum: number | null;
  tem_recorrencia: boolean | null;
  ultima_tarefa_ts: string | null;
  prioridade_mais_comum: string | null;
}

const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function formatarHora(h: number | null): string {
  if (h == null) return '';
  if (h === 0) return '0h';
  if (h < 12) return `${h}h da manhã`;
  if (h === 12) return '12h (meio-dia)';
  return `${h - 12}h da tarde`;
}

/**
 * Lê os patterns do user pra injetar no system prompt do parser de tarefas.
 * Retorna string vazia se user não tem padrões ainda (sem tarefas nos
 * últimos 90 dias ou view vazia).
 */
export async function carregarContextoTarefa(userId: string): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('tarefa_patterns')
    .select('categoria, count, dia_semana_mais_comum, hora_mais_comum, tem_recorrencia, ultima_tarefa_ts, prioridade_mais_comum')
    .eq('user_id', userId)
    .order('count', { ascending: false })
    .limit(8);

  if (error) {
    // View pode não existir ainda (migration 015 não aplicada). Não é erro
    // fatal — parser continua sem contexto de tarefas.
    console.warn('[tarefas/patterns] erro ao ler view:', error.message);
    return '';
  }

  if (!data || data.length === 0) return '';

  const linhas = data.map((p: TarefaPattern) => {
    const dia = p.dia_semana_mais_comum != null ? DIAS_SEMANA[p.dia_semana_mais_comum] : '';
    const hora = formatarHora(p.hora_mais_comum);
    const extras: string[] = [];
    if (dia) extras.push(`costuma ser ${dia}`);
    if (hora) extras.push(`às ${hora}`);
    if (p.tem_recorrencia) extras.push('tem recorrência');
    const suffix = extras.length > 0 ? ` (${extras.join(', ')})` : '';
    return `- categoria "${p.categoria}": ${p.count} tarefa${p.count > 1 ? 's' : ''}${suffix}`;
  });

  return `\n\nMEMÓRIA DE TAREFAS DO USUÁRIO (padrões observados nos últimos 90 dias):\n${linhas.join('\n')}\n\nQuando o usuário mencionar uma tarefa sem categoria explícita, priorize as categorias mais frequentes acima. Se a frase contém pista temporal (dia da semana, hora), use pra inferir.`;
}
