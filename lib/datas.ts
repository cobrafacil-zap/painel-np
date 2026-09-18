/**
 * Conversão de tokens de data/hora (linguagem natural pt-BR) pra
 * representações ISO (`YYYY-MM-DD` e `HH:MM:00`).
 *
 * Usado pelo webhook (compromissos financeiros) e pelo parser/rotas do
 * módulo Tarefas. Centralizado aqui pra manter uma única fonte de regras
 * de interpretação de datas relativas.
 *
 * Os tokens são opacos — o parser retorna o TOKEN (ex: 'SEXTA', '14h'),
 * quem converte pra ISO é esta lib. Isso permite ao Groq devolver tokens
 * estáveis sem precisar calcular datas (que é onde ele mais erra).
 */
import { normalizarAcentos } from './acentos';

export type TokenData =
  | 'HOJE'
  | 'AMANHA'
  | 'SEXTA'
  | 'SABADO'
  | 'DOMINGO'
  | 'SEGUNDA'
  | 'TERCA'
  | 'QUARTA'
  | 'QUINTA'
  | 'FIM_MES'
  | 'SEMANA_QUE_VEM'
  | 'MES_QUE_VEM'
  | `DIA_${number}`
  | `PROX_DIA_${number}`
  | `DAQUI_${number}_DIAS`;

export type TokenHora =
  | `${number}h`
  | `${number}:${number}`
  | 'DE_MANHA'
  | 'DE_TARDE'
  | 'DE_NOITE';

/**
 * Converte um token de data em `YYYY-MM-DD` no fuso local do servidor
 * (BR, gru1 = UTC-3). Aceita tokens opacos do parser + tokens crus do
 * regex local. Aplica normalizarAcentos pra tolerar tokens acentuados
 * (ex: 'AMANHÃ' → 'AMANHA') porque o Groq às vezes devolve com acento
 * e `toUpperCase()` não normaliza Latin-1.
 *
 * @returns ISO date ou null se o token não for reconhecido.
 */
export function tokenParaData(token: string | null | undefined): string | null {
  if (!token) return null;
  // IMPORTANTE: normalizar acentos ANTES de toUpperCase, porque
  // 'AMANHÃ'.toUpperCase() continua 'AMANHÃ' (V8 não normaliza).
  const t = normalizarAcentos(String(token).toUpperCase()).trim();

  // Zera o horário pra comparar só a data
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  if (t === 'HOJE') return isoDate(hoje);

  if (t === 'AMANHA') {
    const amanha = new Date(hoje);
    amanha.setDate(amanha.getDate() + 1);
    return isoDate(amanha);
  }

  // Dia da semana → próxima ocorrência (considerando hoje já conta,
  // ex: se hoje é quarta, "sexta" = +2; se hoje é sexta, "sexta" = hoje).
  const diaSemanaMap: Record<string, number> = {
    DOMINGO: 0,
    SEGUNDA: 1,
    TERCA: 2,
    QUARTA: 3,
    QUINTA: 4,
    SEXTA: 5,
    SABADO: 6,
  };
  if (diaSemanaMap[t] !== undefined) {
    const alvo = diaSemanaMap[t];
    const hojeDow = hoje.getDay();
    let diff = (alvo - hojeDow + 7) % 7;
    const d = new Date(hoje);
    d.setDate(d.getDate() + diff);
    return isoDate(d);
  }

  if (t === 'FIM_MES') {
    const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
    return isoDate(fim);
  }

  if (t === 'SEMANA_QUE_VEM') {
    // Segunda-feira da próxima semana ISO
    const hojeDow = hoje.getDay();
    const diffSeg = (1 - hojeDow + 7) % 7; // dias até segunda (pode ser 0)
    const d = new Date(hoje);
    d.setDate(d.getDate() + diffSeg + 7); // +7 pra ser "que vem", não esta
    return isoDate(d);
  }

  if (t === 'MES_QUE_VEM') {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
    return isoDate(d);
  }

  const mDIA = t.match(/^DIA_(\d{1,2})$/);
  if (mDIA) {
    const dia = parseInt(mDIA[1], 10);
    if (dia >= 1 && dia <= 31) {
      let d = new Date(hoje.getFullYear(), hoje.getMonth(), dia);
      d.setHours(0, 0, 0, 0);
      if (d.getTime() < hoje.getTime()) {
        d = new Date(hoje.getFullYear(), hoje.getMonth() + 1, dia);
      }
      return isoDate(d);
    }
  }

  const mPROX = t.match(/^PROX_DIA_(\d{1,2})$/);
  if (mPROX) {
    const dia = parseInt(mPROX[1], 10);
    if (dia >= 1 && dia <= 31) {
      // "Próximo dia N" SEMPRE vai pro próximo mês (mesmo se hoje é dia
      // anterior — convenção: PROX_DIA = "mês que vem"). Diferente de
      // DIA_ que pega mês atual se ainda não passou.
      const d = new Date(hoje.getFullYear(), hoje.getMonth() + 1, dia);
      return isoDate(d);
    }
  }

  const mDAQUI = t.match(/^DAQUI_(\d{1,2})_DIAS$/);
  if (mDAQUI) {
    const n = parseInt(mDAQUI[1], 10);
    if (n >= 1 && n <= 365) {
      const d = new Date(hoje);
      d.setDate(d.getDate() + n);
      return isoDate(d);
    }
  }

  return null;
}

/**
 * Converte um token de hora em `HH:MM:00` (formato `time` do Postgres).
 * Aceita '14h', '14:30', 'DE_MANHA' (09:00), 'DE_TARDE' (14:00),
 * 'DE_NOITE' (20:00).
 *
 * @returns string no formato `HH:MM:SS` ou null se não reconhecido.
 */
export function tokenParaHora(token: string | null | undefined): string | null {
  if (!token) return null;
  const t = String(token).trim();

  // Macros
  if (/^de[\s_-]?manh[ãa]$/i.test(t)) return '09:00:00';
  if (/^de[\s_-]?tarde$/i.test(t)) return '14:00:00';
  if (/^de[\s_-]?noite$/i.test(t)) return '20:00:00';

  // HHh ou HHhMM (sem espaço)
  const mH = t.match(/^(\d{1,2})h(?:(\d{2}))?$/i);
  if (mH) {
    const h = parseInt(mH[1], 10);
    const mm = mH[2] ? parseInt(mH[2], 10) : 0;
    if (h >= 0 && h <= 23 && mm >= 0 && mm <= 59) {
      return `${pad2(h)}:${pad2(mm)}:00`;
    }
    return null;
  }

  // HH:MM
  const mHM = t.match(/^(\d{1,2}):(\d{2})$/);
  if (mHM) {
    const h = parseInt(mHM[1], 10);
    const mm = parseInt(mHM[2], 10);
    if (h >= 0 && h <= 23 && mm >= 0 && mm <= 59) {
      return `${pad2(h)}:${pad2(mm)}:00`;
    }
    return null;
  }

  return null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
