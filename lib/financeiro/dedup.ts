/**
 * Detecção de duplicata semântica — identifica quando o usuário tenta
 * registrar o MESMO gasto 2x em mensagens diferentes.
 *
 * Diferente do unique constraint (que cobre reentrega do webhook), esse
 * aqui compara semanticamente: mesmo valor + mesma categoria + mesmo
 * description (com tolerância) + janela de tempo.
 *
 * Retorna o match mais provável pra perguntar pro usuário se confirma.
 */

import { createServiceClient } from '@/lib/supabase/server';

export interface DuplicataCandidate {
  amount: number;
  category: string | null;
  description: string | null;
  payment_method: string | null;
  occurred_at: string; // ISO date ou datetime
  paymentMethodTolerance?: boolean; // aceita diferença de método de pgto
}

export interface DuplicataMatch {
  id: string;
  amount: number;
  category: string | null;
  description: string | null;
  occurred_at: string;
  similarity: number; // 0..1
  created_at: string;
}

interface RecordRow {
  id: string;
  type: string;
  amount: number;
  category: string | null;
  description: string | null;
  occurred_at: string;
  created_at: string;
}

/**
 * Distância de Levenshtein normalizada (0..1, sendo 0 = idêntico).
 * Adaptada pra tolerar case e acentos.
 */
function normalizar(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos
    .replace(/[^a-z0-9\s]/g, '') // remove pontuação
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function similarity(a: string | null, b: string | null): number {
  const na = normalizar(a);
  const nb = normalizar(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  const maxLen = Math.max(na.length, nb.length);
  return 1 - levenshtein(na, nb) / maxLen;
}

/**
 * Procura o candidato mais provável de ser duplicata.
 * Critérios (todos precisam casar):
 * - type === 'gasto'
 * - valor exatamente igual (ou ±5% pra tolerar centavos)
 * - occurred_at dentro de windowHours do candidato
 * - E (description similar ≥ 0.5 OU category igual OU amount diff < 1%)
 *
 * Retorna null se nenhum match forte o suficiente.
 */
export async function detectarDuplicata(
  userId: string,
  candidate: DuplicataCandidate,
  windowHours = 48
): Promise<DuplicataMatch | null> {
  const supabase = createServiceClient();

  // Janela de tempo centrada no occurred_at do candidato
  const dataBase = new Date(candidate.occurred_at);
  const from = new Date(dataBase.getTime() - windowHours * 3600_000);
  const to = new Date(dataBase.getTime() + windowHours * 3600_000);

  const { data } = await supabase
    .from('records')
    .select('id, type, amount, category, description, occurred_at, created_at')
    .eq('user_id', userId)
    .eq('type', 'gasto')
    .gte('occurred_at', from.toISOString().slice(0, 10))
    .lte('occurred_at', to.toISOString().slice(0, 10))
    .limit(50);

  if (!data || data.length === 0) return null;

  // Pontua cada candidato
  let best: { row: RecordRow; score: number; similarity: number } | null = null;

  for (const row of data as RecordRow[]) {
    const valorDiff = Math.abs(Number(row.amount) - candidate.amount);
    const valorRatio = candidate.amount > 0 ? valorDiff / candidate.amount : 1;
    if (valorDiff > 0.01 && valorRatio > 0.05) continue; // valor muito diferente

    const simDesc = similarity(row.description, candidate.description);
    const mesmaCategoria = row.category && candidate.category && row.category === candidate.category;
    const mesmoValorExato = valorDiff < 0.01;

    // Precisa de pelo menos um sinal forte de similaridade
    let sinais = 0;
    if (simDesc >= 0.5) sinais += 2;
    if (mesmaCategoria) sinais += 1;
    if (mesmoValorExato) sinais += 1;
    if (sinais < 2) continue;

    const score = simDesc + (mesmaCategoria ? 0.3 : 0) + (mesmoValorExato ? 0.2 : 0);
    if (!best || score > best.score) {
      best = { row, score, similarity: simDesc };
    }
  }

  if (!best) return null;

  // Só considera duplicata se score for alto o suficiente
  if (best.score < 0.5) return null;

  return {
    id: best.row.id,
    amount: Number(best.row.amount),
    category: best.row.category,
    description: best.row.description,
    occurred_at: best.row.occurred_at,
    similarity: Math.round(best.similarity * 100) / 100,
    created_at: best.row.created_at,
  };
}

/**
 * Formata a mensagem que o bot manda quando detecta possível duplicata.
 */
export function formatarMensagemDuplicata(
  match: DuplicataMatch,
  candidate: DuplicataCandidate
): string {
  const hora = new Date(match.created_at).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const desc = match.description ?? match.category ?? 'esse gasto';
  const valorOrigem = formatBRL(match.amount);
  const valorNovo = formatBRL(candidate.amount);
  const mesmoValor = Math.abs(match.amount - candidate.amount) < 0.01;
  return `🤔 Isso parece igual ao que você registrou às ${hora}: ${desc} ${valorOrigem}${mesmoValor ? '' : ` (vs ${valorNovo} agora)`}.\n\nÉ outro mesmo? Responde 'sim' pra registrar de novo ou 'não' pra ignorar.`;
}

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
