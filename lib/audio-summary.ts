/**
 * Sumário de transcrição de áudio (#overhaul audio).
 *
 * Recebe a transcrição crua do Whisper e retorna um sumário estruturado
 * gerado por Groq `llama-3.1-8b-instant` (mesmo já carregado pelo parser
 * financeiro — zero overhead de cold-start).
 *
 * Tolerante a falha: retorna `null` em qualquer erro (rate limit, 5xx,
 * JSON inválido). O caller (webhook) loga e segue — a transcrição já
 * está salva no banco, então o áudio fica utilizável mesmo sem sumário.
 *
 * Não usa embeddings/pgvector. A busca textual em `messages_transcription_fts`
 * (criada pela migration 016) cobre "qual áudio falou sobre X?" com
 * stemming PT-BR nativo do Postgres.
 */

import { generateText } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { logStage, logError } from './log';

let _groq: ReturnType<typeof createGroq> | null = null;
function getGroq() {
  if (_groq) return _groq;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY não configurada');
  _groq = createGroq({ apiKey });
  return _groq;
}

export interface AudioSummary {
  /** 1-2 frases (≤200 chars) capturando a informação principal. */
  summary: string;
  /** 3-7 tags curtas em lowercase. Ex: ["finanças","mercado","pix"]. */
  topics: string[];
  /** Entidades detectadas — pessoas, locais, valores monetários. */
  entities: {
    people: string[];
    amounts: number[];
    places: string[];
  };
}

const SYSTEM_PROMPT = `Você resume transcrições de áudios curtos de WhatsApp em PT-BR.
Responda SEMPRE em JSON puro (sem markdown, sem comentários, sem texto antes/depois).

SAÍDA (JSON ESTRITO):
{
  "summary": "1-2 frases curtas (máximo 200 chars) capturando a informação principal",
  "topics": ["tag1", "tag2", "tag3"],  // 3-7 tags curtas em lowercase, sem acento
  "entities": {
    "people": ["nome1", "nome2"],       // nomes próprios mencionados (vazio se nenhum)
    "amounts": [50, 100],               // valores monetários detectados como números puros
    "places": ["mercado", "escritório"]  // locais mencionados (vazio se nenhum)
  }
}

REGRAS:
- Tópicos devem ser específicos ("feira", "pix", "dentista"), não genéricos ("áudio", "conversa")
- amounts: só valores monetários explícitos (não datas, não telefones)
- people: só nomes próprios (não pronomes como "eu", "ele")
- Se incerto, retorne arrays vazios — não invente
- Idioma: pt-BR`;

const MAX_TRANSCRIPTION_CHARS = 4000; // 8B Instant lida bem com isso; truncamos pra não estourar latência

/**
 * Resume uma transcrição. Retorna `null` se LLM falhar ou JSON for
 * inválido. Não lança — o caller trata como best-effort.
 */
export async function summarizeAudio(
  transcription: string,
): Promise<AudioSummary | null> {
  if (!transcription || transcription.trim().length < 5) return null;

  const texto = transcription.length > MAX_TRANSCRIPTION_CHARS
    ? transcription.slice(0, MAX_TRANSCRIPTION_CHARS) + '…'
    : transcription;

  try {
    const groq = getGroq();
    const t0 = Date.now();
    const { text } = await generateText({
      model: groq('llama-3.1-8b-instant'),
      system: SYSTEM_PROMPT,
      prompt: `Transcrição:\n"""\n${texto}\n"""`,
      temperature: 0.2, // baixa criatividade — queremos sumário fiel, não criativo
      maxTokens: 350, // ~200 chars summary + 7 topics + entities
    });
    logStage('audio_summary_ok', Date.now() - t0, { len: texto.length });

    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]);

    // Sanitização defensiva — LLM pode devolver campos extras ou tipos errados
    const summary = typeof parsed.summary === 'string'
      ? parsed.summary.slice(0, 250).trim()
      : '';

    const topics: string[] = Array.isArray(parsed.topics)
      ? parsed.topics
          .filter((t: unknown): t is string => typeof t === 'string')
          .map((t: string) => t.toLowerCase().trim().slice(0, 30))
          .filter(Boolean)
          .slice(0, 7)
      : [];

    const entities = parsed.entities && typeof parsed.entities === 'object'
      ? {
          people: Array.isArray(parsed.entities.people)
            ? parsed.entities.people.filter((p: unknown): p is string => typeof p === 'string').slice(0, 10)
            : [],
          amounts: Array.isArray(parsed.entities.amounts)
            ? parsed.entities.amounts
                .filter((a: unknown) => typeof a === 'number' && Number.isFinite(a))
                .slice(0, 10)
            : [],
          places: Array.isArray(parsed.entities.places)
            ? parsed.entities.places.filter((p: unknown): p is string => typeof p === 'string').slice(0, 10)
            : [],
        }
      : { people: [], amounts: [], places: [] };

    if (!summary) return null;

    return { summary, topics, entities };
  } catch (e) {
    logError('audio_summary', e, { len: texto.length });
    return null;
  }
}
