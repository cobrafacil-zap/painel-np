/**
 * Transcrição de áudio via Groq Whisper.
 * Recebe base64 (formato que vem da Evolution com base64: true no webhook)
 * e retorna texto em PT-BR.
 *
 * Usa o endpoint REST direto (mais simples que SDK pra upload multipart).
 *
 * Retry: até 3 tentativas (1 inicial + 2 retries) com backoff 4s/8s.
 * Decisão: Whisper responde em 2-5s pra clipes < 15s; retry só dispara
 * em falha de rede transitória. Em falha persistente, retorna null e o
 * webhook trata com mensagem amigável.
 */

import { logError, logStage } from './log';

interface GroqWhisperResponse {
  text: string;
  x_groq?: { id: string };
}

const WHISPER_PROMPT =
  'Transcrição em português brasileiro de áudio curto de WhatsApp. ' +
  // Vocabulário financeiro
  'Vocabulário comum: gasto, gastei, recebi, paguei, mercado, posto, ' +
  'farmácia, fatura, parcela, empréstimo, emprestei, peguei, conta, ' +
  'cartão, pix, boleto, transferência, salário, freelance, aluguel. ' +
  // Vocabulário de tarefas/lembretes
  'Tarefas: reunião, ligar, lembrete, marcar, dentista, entregar, ' +
  'campanha, agendar, consulta, médico, aniversário. ' +
  // Vocabulário de meta diária
  'Meta diária: meta, limite, teto, máximo, configurar, definir. ' +
  // Cardinais comuns (Whisper erra números por extenso)
  'Numerais: cinquenta, sessenta, setenta, oitenta, noventa, cem, ' +
  'duzentos, trezentos, quatrocentos, quinhentos, seiscentos, oitocentos, ' +
  'mil, dois mil, cinco mil.';

export async function transcreverAudio(
  base64Audio: string,
  mimeType: string = 'audio/ogg',
): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    logError('transcricao', new Error('GROQ_API_KEY não configurada'));
    return null;
  }

  // Converte base64 → Buffer → Blob (form-data multipart)
  const buffer = Buffer.from(base64Audio, 'base64');
  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });

  // Detecta extensão pelo mimeType
  const ext = mimeType.includes('mp4') ? 'm4a'
    : mimeType.includes('mpeg') ? 'mp3'
    : mimeType.includes('wav') ? 'wav'
    : mimeType.includes('webm') ? 'webm'
    : 'ogg';

  const RETRIES = 3;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const t0 = Date.now();
    try {
      const form = new FormData();
      form.append('file', blob, `audio.${ext}`);
      form.append('model', 'whisper-large-v3');
      form.append('prompt', WHISPER_PROMPT);
      form.append('language', 'pt');
      form.append('response_format', 'json');

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(45_000), // áudios longos podem demorar
      });

      const elapsed = Date.now() - t0;

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        logError('transcricao_http', new Error(`HTTP ${res.status}`), {
          attempt,
          status: res.status,
          body: errBody.slice(0, 200),
        });
        // 4xx (não-retentável): sai do loop
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          return null;
        }
        // 5xx ou 429: tenta de novo se tem tentativas sobrando
        if (attempt < RETRIES) {
          await sleep(attempt * 4_000);
          continue;
        }
        return null;
      }

      const json = (await res.json()) as GroqWhisperResponse;
      const text = json.text?.trim() || null;
      logStage('transcricao_ok', elapsed, {
        attempt,
        mimeType,
        bytes: buffer.byteLength,
        len: text?.length ?? 0,
      });
      return text;
    } catch (e) {
      const elapsed = Date.now() - t0;
      logError('transcricao_attempt', e, { attempt, elapsedMs: elapsed });
      if (attempt < RETRIES) {
        await sleep(attempt * 4_000);
        continue;
      }
      return null;
    }
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
