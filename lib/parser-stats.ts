/**
 * Contador simples de estágios do parser — observabilidade mínima sem
 * dependência externa (Datadog/PostHog/etc).
 *
 * Singleton in-memory. Em ambiente serverless long-lived (Fluid Compute),
 * acumula entre requests da mesma instância. Em cold starts, zera — ok.
 *
 * Loga resumo a cada 100 incrementos pra não poluir o log.
 */

import { logStage } from './log';

type Stage =
  | 'parser_ok'
  | 'parser_timeout'
  | 'parser_error'
  | 'parser_low_confidence'
  | 'cache_hit'
  | 'cache_miss'
  | 'auto_category_created'
  | 'auto_category_skipped';

const counters: Record<Stage, number> = {
  parser_ok: 0,
  parser_timeout: 0,
  parser_error: 0,
  parser_low_confidence: 0,
  cache_hit: 0,
  cache_miss: 0,
  auto_category_created: 0,
  auto_category_skipped: 0,
};

let total = 0;
const LOG_EVERY = 100;

export function recordParserStage(stage: Stage) {
  counters[stage]++;
  total++;
  if (total % LOG_EVERY === 0) {
    logStage('stats', undefined, {
      msg: total,
      ...counters,
    });
  }
}

/**
 * Lê snapshot (usado em testes/debug). Não reseta.
 */
export function getParserStats() {
  return { msg: total, ...counters };
}

/**
 * Reseta contadores (usado em testes).
 */
export function resetParserStats() {
  for (const k of Object.keys(counters) as Stage[]) counters[k] = 0;
  total = 0;
}
