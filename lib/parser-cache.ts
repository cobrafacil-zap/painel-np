/**
 * Cache in-memory do parser financeiro.
 *
 * - Key: texto normalizado (trim + lowercase + collapse_whitespace).
 *   Mesma frase com capitalização diferente = mesmo cache hit.
 * - Value: { result: ParsedIntent; ts: number }.
 * - TTL: 30min (mesmo da sessão em `lib/whatsapp/session.ts:15`).
 * - Limite: 500 entradas. Quando excede, descarta a mais antiga
 *   (LRU-ish por timestamp).
 *
 * Por que só `intent !== 'outro' && confidence >= 0.85`:
 *   - Resultados de baixa confiança ou `outro` dependem de contexto
 *     (sessão, padrões). Cachear eles repetiria erro.
 *   - O threshold 0.85 casa com o que `parseMensagem` usa pra aceitar
 *     local hit (parser-mensagem.ts:719).
 *
 * Singleton — mesma instância compartilhada por todos os requests da
 * mesma instância Vercel (Fluid Compute). Em cold start começa vazio.
 *
 * Pra desligar em produção: `PARSER_CACHE_TTL_MS=0`.
 */

import { recordParserStage } from './parser-stats';
import { logStage } from './log';

const TTL_MS = Number(process.env.PARSER_CACHE_TTL_MS ?? 30 * 60 * 1000);
const MAX_ENTRIES = 500;

interface CacheEntry {
  result: { intent: string; confidence?: number };
  ts: number;
}

const cache = new Map<string, CacheEntry>();

function normalize(texto: string): string {
  return texto.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Tenta cache hit. Se acertar e for "cacheable" (confidence alta, não outro),
 * retorna. Senão chama `compute()` e armazena.
 */
export async function getOrCompute<T extends { intent: string; confidence?: number }>(
  texto: string,
  compute: () => Promise<T>,
): Promise<T> {
  if (TTL_MS <= 0) {
    recordParserStage('cache_miss');
    return compute();
  }

  const key = normalize(texto);
  const now = Date.now();

  const hit = cache.get(key);
  if (hit && now - hit.ts < TTL_MS) {
    recordParserStage('cache_hit');
    logStage('parser_cache_hit', undefined, { key: key.slice(0, 40) });
    return hit.result as unknown as T;
  }

  recordParserStage('cache_miss');
  const result = await compute();

  // Só cacheia se for utilizável depois
  if (result && result.intent !== 'outro' && (result.confidence ?? 0) >= 0.85) {
    cache.set(key, { result: result as unknown as CacheEntry['result'], ts: now });

    // LRU-ish: se passou do limite, remove o mais antigo
    if (cache.size > MAX_ENTRIES) {
      let oldestKey: string | null = null;
      let oldestTs = Infinity;
      for (const [k, v] of cache.entries()) {
        if (v.ts < oldestTs) {
          oldestTs = v.ts;
          oldestKey = k;
        }
      }
      if (oldestKey) cache.delete(oldestKey);
    }
  }

  return result;
}

/**
 * Limpa o cache (usado em testes).
 */
export function clearParserCache() {
  cache.clear();
}

/**
 * Tamanho atual (debug).
 */
export function parserCacheSize(): number {
  return cache.size;
}
