/**
 * Normalização de acentos pt-BR pra uso em regex e comparação de tokens.
 *
 * IMPORTANTE 1: o engine de regex do V8 (sem flag `u`) trata letras
 * acentuadas Latin-1 (ã, á, à, é, ê, í, ó, ô, ú, ç, etc.) como
 * non-word, então `\b` falha antes/depois delas. Ex: /\bamanhã\b/
 * não casa "amanhã" porque o `\b` antes do `ã` exige que o char
 * anterior seja `[a-zA-Z0-9_]`, e o `ã` (0xE3) não está nesse set.
 *
 * IMPORTANTE 2: `'ã'.toUpperCase()` retorna 'Ã' MAS em UTF-8 é
 * codificado como `A` (0x41) + til combinando (0x30,3) — NFD. Os
 * regexes `replace(/[áàâãä]/gi, 'a')` não pegam o til combinando
 * porque eles esperam o char Latin-1 único (0xC3). Por isso
 * SEMPRE chamamos `.normalize('NFD')` antes de aplicar os replaces
 * — isso força decomposição (char + combining mark) e garante que
 * o replace pega.
 *
 * Solução: normalizar a string, substituindo acentos por letras sem
 * acento. A string original (com acentos) é preservada em outros
 * lugares (renderização, mensagens pro usuário).
 *
 * Cobre os acentos mais comuns em pt-BR.
 */
export function normalizarAcentos(s: string): string {
  if (!s) return s;
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove todos os combining marks (acentos)
    .replace(/ç/gi, 'c')
    .replace(/ñ/gi, 'n');
}

