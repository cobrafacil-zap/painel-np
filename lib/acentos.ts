/**
 * Normalização de acentos pt-BR pra uso em regex.
 *
 * IMPORTANTE: o engine de regex do V8 (sem flag `u`) trata letras
 * acentuadas Latin-1 (ã, á, à, é, ê, í, ó, ô, ú, ç, etc.) como
 * non-word, então `\b` falha antes/depois delas. Ex: /\bamanhã\b/
 * não casa "amanhã" porque o `\b` antes do `ã` exige que o char
 * anterior seja `[a-zA-Z0-9_]`, e o `ã` (0xE3) não está nesse set.
 *
 * Solução: normalizar a string antes do regex, substituindo acentos
 * por letras sem acento. A string original (com acentos) é preservada
 * em outros lugares (renderização, mensagens pro usuário).
 *
 * Cobre os acentos mais comuns em pt-BR.
 */
export function normalizarAcentos(s: string): string {
  if (!s) return s;
  return s
    .replace(/[áàâãä]/gi, 'a')
    .replace(/[éèêë]/gi, 'e')
    .replace(/[íìîï]/gi, 'i')
    .replace(/[óòôõö]/gi, 'o')
    .replace(/[úùûü]/gi, 'u')
    .replace(/ç/gi, 'c')
    .replace(/ñ/gi, 'n');
}
