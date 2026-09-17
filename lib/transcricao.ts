/**
 * Transcrição de áudio via Groq Whisper.
 * Recebe base64 (formato que vem da Evolution com base64: true no webhook)
 * e retorna texto em PT-BR.
 *
 * Usa o endpoint REST direto (mais simples que SDK pra upload multipart).
 */

interface GroqWhisperResponse {
  text: string;
  x_groq?: { id: string };
}

export async function transcreverAudio(
  base64Audio: string,
  mimeType: string = 'audio/ogg',
): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('[transcricao] GROQ_API_KEY não configurada');
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

  const form = new FormData();
  form.append('file', blob, `audio.${ext}`);
  form.append('model', 'whisper-large-v3');
  // Prompt de contexto: orienta o Whisper a preferir termos comuns do
  // vocabulário financeiro em PT-BR (mercado, posto, fatura, parcela).
  form.append(
    'prompt',
    'Transcrição em português brasileiro de áudio curto de WhatsApp. ' +
    'Vocabulário comum: gasto, gastei, recebi, paguei, mercado, posto, ' +
    'farmácia, fatura, parcela, empréstimo, emprestei, peguei.',
  );
  form.append('language', 'pt');
  form.append('response_format', 'json');

  try {
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(45_000), // áudios longos podem demorar
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(`[transcricao] Groq HTTP ${res.status}: ${errBody.slice(0, 200)}`);
      return null;
    }

    const json = (await res.json()) as GroqWhisperResponse;
    return json.text?.trim() || null;
  } catch (e) {
    console.error('[transcricao] erro:', e);
    return null;
  }
}
