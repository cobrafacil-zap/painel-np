/**
 * Logger estruturado mínimo — substitui `console.log('[xxx] ...')` espalhado.
 *
 * Formato: `[stage=X ms=Y meta={...}]` ou `[error stage=X ...]` — fácil de
 * grep e de parsear por logs externos (Vercel, Datadog).
 *
 * Usa `process.stdout.write` (não console.log) pra flushar imediato no
 * serverless — sem isso, logs podem chegar atrasados ou em batch no
 * response, perdendo precisão de timing.
 */

type Meta = Record<string, unknown>;

function emit(prefix: string, meta: Meta) {
  const json = Object.keys(meta).length > 0 ? ` meta=${JSON.stringify(meta)}` : '';
  const line = `[${prefix}${json}]\n`;
  // stderr pra error/warn (Vercel separa níveis), stdout pro resto.
  if (prefix.startsWith('error')) process.stderr.write(line);
  else process.stdout.write(line);
}

export function logStage(stage: string, ms?: number, meta?: Meta) {
  const payload: Meta = { ...(meta ?? {}) };
  if (typeof ms === 'number') payload.ms = ms;
  emit(`stage=${stage}`, payload);
}

export function logError(stage: string, err: unknown, meta?: Meta) {
  const e = err as { message?: string; code?: string; name?: string };
  emit('error stage=' + stage, {
    ...(meta ?? {}),
    err: e?.message ?? String(err),
    code: e?.code,
    name: e?.name,
  });
}

export function logDebug(stage: string, meta?: Meta) {
  if (process.env.DEBUG !== '1') return;
  emit('debug stage=' + stage, meta ?? {});
}
