/**
 * Conversão de números por extenso (PT-BR) pra dígitos.
 *
 * Usado pelos parsers (financeiro + tarefas) pra normalizar transcrições
 * de áudio do Whisper, que entregam fala natural ("cento e trinta e cinco")
 * em vez de dígitos.
 *
 * Suporta: zero a trilhões. Composto: "duzentos e cinquenta e três",
 * "mil duzentos", "dois mil e quinhentos", "um milhão e cem".
 *
 * Limitação: cobre os casos comuns de áudio curto de WhatsApp (valores até
 * ~100 mil). Não tenta ser exaustivo — fora isso, deixa o Groq resolver.
 */
export function numerosPorExtensoParaDigitos(texto: string): string {
  const UNIDADES: Record<string, number> = {
    zero: 0, um: 1, uma: 1, dois: 2, duas: 2, três: 3, quatro: 4,
    cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  };
  const DEZ_BASICO: Record<string, number> = {
    dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14,atorze: 14,
    quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
  };
  const DEZETAS: Record<string, number> = {
    vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50,
    sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
  };
  const CENTENAS: Record<string, number> = {
    cem: 100, cento: 100, duzentos: 200, duzentas: 200,
    trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400,
    quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600,
    setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800,
    novecentos: 900, novecentas: 900,
  };

  /**
   * Converte um número entre 0 e 999 (em palavras PT-BR) pra número.
   * Retorna null se não conseguir parsear.
   */
  function ate999(tokens: string[]): number | null {
    let atual = 0;
    for (const tk of tokens) {
      if (UNIDADES[tk] !== undefined) atual += UNIDADES[tk];
      else if (DEZ_BASICO[tk] !== undefined) atual += DEZ_BASICO[tk];
      else if (DEZETAS[tk] !== undefined) atual += DEZETAS[tk];
      else if (CENTENAS[tk] !== undefined) atual += CENTENAS[tk];
      else if (tk === 'e') {
        // conector "e" entre centenas/dezenas/unidades — ignora
      } else {
        return null;
      }
    }
    return atual > 0 ? atual : null;
  }

  // Match sequência contígua de palavras numéricas (com 'e' conector).
  // Word boundary no fim evita cortar a próxima palavra real (ex: depois
  // de "cento e trinta e cinco" vir "reais" — boundary garante que
  // "reais" não entra na match).
  const wordSet =
    'e|zero|um|uma|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|onze|' +
    'doze|treze|catorze|atorze|quinze|dezesseis|dezessete|dezoito|dezenove|' +
    'vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|' +
    'duzentos|duzentas|trezentos|trezentas|quatrocentos|quatrocentas|' +
    'quinhentos|quinhentas|seiscentos|seiscentas|setecentos|setecentas|' +
    'oitocentos|oitocentas|novecentos|novecentas|mil|milhões|milhão|hões|' +
    'bilhões|bilhão';
  const re = new RegExp(
    `(?:\\b(?:${wordSet})\\s+)*(?:\\b(?:${wordSet})\\b)`,
    'gi'
  );

  return texto.replace(re, (match) => {
    const tokens = match.toLowerCase().trim().split(/\s+/);
    // "uma/um" sozinho é artigo, não número — não troca
    if (tokens.length === 1) {
      const tk = tokens[0];
      if (tk === 'uma' || tk === 'um') return match;
      if (
        UNIDADES[tk] === undefined &&
        DEZ_BASICO[tk] === undefined &&
        DEZETAS[tk] === undefined &&
        CENTENAS[tk] === undefined &&
        !['mil', 'milhão', 'milhões', 'hão', 'hões', 'bilhão', 'bilhões'].includes(tk)
      ) {
        return match;
      }
    }
    let total = 0;
    let grupoAtual = 0; // 0-999
    for (const tk of tokens) {
      if (tk === 'mil') {
        if (grupoAtual === 0) grupoAtual = 1;
        total += grupoAtual * 1000;
        grupoAtual = 0;
      } else if (tk === 'milhão' || tk === 'milhões' || tk === 'hão' || tk === 'hões') {
        if (grupoAtual === 0) grupoAtual = 1;
        total += grupoAtual * 1_000_000;
        grupoAtual = 0;
      } else if (tk === 'bilhão' || tk === 'bilhões') {
        if (grupoAtual === 0) grupoAtual = 1;
        total += grupoAtual * 1_000_000_000;
        grupoAtual = 0;
      } else if (tk === 'e') {
        // ignora
      } else {
        const v = ate999([tk]);
        if (v !== null) grupoAtual += v;
        else return match;
      }
    }
    total += grupoAtual;
    return total > 0 ? String(total) : match;
  });
}
