/**
 * NER leve (Named Entity Recognition) sem ML — só regex + dicionário.
 *
 * Reconhece:
 * - Pessoas: nomes próprios precedidos de preposição ("com a Priscila",
 *   "do João"). Exclui palavras comuns.
 * - Fornecedores: marcas/empresas conhecidas (Vivo, Claro, Tim, Sky, etc).
 * - Lugares: locais precedidos de preposição ("no Mercado", "na Padaria").
 *
 * É plugado no parser-mensagem.ts antes do Groq e salvo no metadata
 * do record. Também usado pra enriquecer o system prompt.
 */

import { normalizarAcentos } from '@/lib/acentos';

export interface Entities {
  pessoas: string[];
  lugares: string[];
  fornecedores: string[];
}

// Palavras comuns que NÃO devem ser confundidas com nome próprio
const STOPWORDS_PESSOAS = new Set([
  'reunião',
  'reuniao',
  'segunda',
  'terça',
  'terca',
  'quarta',
  'quinta',
  'sexta',
  'sabado',
  'sábado',
  'domingo',
  'hoje',
  'amanhã',
  'amanha',
  'semana',
  'mes',
  'mês',
  'ano',
  'dia',
  'noite',
  'manhã',
  'manha',
  'tarde',
  'hora',
  'horas',
  'conta',
  'casa',
  'trabalho',
  'banco',
  'agência',
  'agencia',
  'consulta',
  'faculdade',
  'escola',
  'rua',
  'avenida',
]);

// Fornecedores conhecidos de utilidades/serviços. Tudo minúsculo e sem acento.
const FORNECEDORES = new Set([
  'vivo',
  'claro',
  'tim',
  'oi',
  'sky',
  'net',
  'combo',
  'fibra',
  'algar',
  'nextel',
  'semp',
  'tcl',
  'lg',
  'samsung',
  'apple',
  'amazon',
  'mercado livre',
  'mercadolivre',
  'magazine luiza',
  'magalu',
  'casas bahia',
  'americanas',
  'submarino',
  'extra',
  'carrefour',
  'assai',
  'atacadão',
  'atacadao',
  'tenda',
  'leroy merlin',
  'leroy',
  'c&a',
  'renner',
  'riachuelo',
  'shein',
  'aliexpress',
  'shopee',
  'ifood',
  'rappi',
  'uber',
  '99',
  'cabify',
  'spotify',
  'netflix',
  'amazon prime',
  'prime video',
  'disney',
  'hbo',
  'globoplay',
  'youtube',
  'apple music',
  'deezer',
  'smart fit',
  'just fit',
  'academia smart',
  'unimed',
  'hapvida',
  'amil',
  'bradesco',
  'itau',
  'itaú',
  'santander',
  'caixa',
  'nubank',
  'inter',
  'c6',
  'next',
  'picpay',
  'will',
  'cripto',
  'binance',
  'mercado bitcoin',
  'foxbit',
]);

// Palavras comuns que NÃO devem ser confundidas com lugar
const STOPWORDS_LUGARES = new Set([
  'dia',
  'semana',
  'mes',
  'mês',
  'ano',
  'noite',
  'manha',
  'manhã',
  'tarde',
  'hora',
  'horas',
  'minuto',
  'minutos',
  'momento',
  'trabalho',
  'casa',
  'escritório',
  'escritorio',
  'reunião',
  'reuniao',
  'consulta',
  'faculdade',
  'escola',
  'banco',
  'agência',
  'agencia',
  'padaria',
  'mercado',
  'feira',
  'bar',
  'restaurante',
  'lanchonete',
  'cafeteria',
  'shopping',
  'posto',
  'hospital',
  'farmacia',
  'academia',
]);

/**
 * Extrai entidades da frase. Recebe texto cru e devolve listas deduplicadas
 * (preservando a capitalização original).
 */
export function extrairEntidades(texto: string): Entities {
  const original = texto;
  const norm = normalizarAcentos(texto.toLowerCase());
  const pessoas = new Set<string>();
  const lugares = new Set<string>();
  const fornecedores = new Set<string>();

  // === PESSOAS ===
  // "com a Priscila", "do João", "pra Maria", "com Paulo", "com Priscila"
  const rePessoa = /(?:com|de|para|pra|pro|da|do|na|no|em)\s+(?:a|o)?\s*([A-ZÀ-Ú][a-zà-ú]{2,})\b/g;
  let m: RegExpExecArray | null;
  while ((m = rePessoa.exec(original)) !== null) {
    const candidato = m[1].trim();
    const candNorm = normalizarAcentos(candidato.toLowerCase());
    // Não é pessoa se for stopword OU fornecedor conhecido
    if (
      !STOPWORDS_PESSOAS.has(candNorm) &&
      !FORNECEDORES.has(candNorm)
    ) {
      pessoas.add(candidato);
    }
  }

  // === FORNECEDORES ===
  // Match de palavras/expressões conhecidas (case-insensitive)
  const palavras = norm
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  for (let i = 0; i < palavras.length; i++) {
    // tenta 1, 2 e 3 palavras (pegar "mercado livre", "magazine luiza")
    for (let n = 1; n <= 3 && i + n <= palavras.length; n++) {
      const expr = palavras.slice(i, i + n).join(' ');
      if (FORNECEDORES.has(expr)) {
        // Recupera versão original com capitalização da primeira letra
        const origExpr = original
          .toLowerCase()
          .replace(/[^\w\s]/g, ' ')
          .split(/\s+/)
          .slice(i, i + n)
          .join(' ');
        const capitalizada = origExpr
          .split(' ')
          .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
          .join(' ');
        fornecedores.add(capitalizada);
        i += n - 1;
        break;
      }
    }
  }

  // === LUGARES ===
  // "no Mercado", "na Padaria", "em Casa"
  // Regra mais conservadora: só captura a PRIMEIRA palavra após prep
  // (evita capturar "Mercado Livre" como pessoa) e exige que não seja
  // uma pessoa já detectada.
  const reLugar = /(?:no|na|em)\s+([A-ZÀ-Ú][\wÀ-ú]{2,})/g;
  while ((m = reLugar.exec(original)) !== null) {
    const candidato = m[1].trim();
    const candidatoNorm = normalizarAcentos(candidato.toLowerCase());
    // Não é lugar se for stopword ou já é pessoa detectada
    if (
      !STOPWORDS_LUGARES.has(candidatoNorm) &&
      !pessoas.has(candidato)
    ) {
      lugares.add(candidato);
    }
  }

  return {
    pessoas: Array.from(pessoas),
    lugares: Array.from(lugares),
    fornecedores: Array.from(fornecedores),
  };
}

/**
 * Formata entidades como string curta pra injetar no system prompt do Groq.
 * Retorna string vazia se não tem nada.
 */
export function formatarEntidadesParaPrompt(entities: Entities): string {
  const partes: string[] = [];
  if (entities.pessoas.length) partes.push(`pessoas: ${entities.pessoas.join(', ')}`);
  if (entities.lugares.length) partes.push(`lugares: ${entities.lugares.join(', ')}`);
  if (entities.fornecedores.length)
    partes.push(`fornecedores: ${entities.fornecedores.join(', ')}`);
  return partes.length ? `\n\nENTIDADES DETECTADAS: ${partes.join(' | ')}` : '';
}
