/**
 * Cliente para Evolution API (WhatsApp não-oficial, self-hosted).
 *
 * Reaproveitado do PAINEL GL. Diferenças:
 * - O nome da instância é fixo em EVOLUTION_INSTANCE (uma instância por app).
 * - Mantém as funções de envio de texto e imagem.
 * - Adiciona `evolutionEnviarTextoPorNumero()` para enviar para o número pessoal,
 *   usado pelo webhook como resposta.
 */

export class EvolutionNotConfiguredError extends Error {
  constructor() {
    super(
      "Evolution API não configurada. Defina EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE nas variáveis de ambiente."
    );
    this.name = "EvolutionNotConfiguredError";
  }
}

function lerEnv(nome: string): string | null {
  const v = process.env[nome];
  return v && v.trim() ? v.trim() : null;
}

export function evolutionConfig() {
  const baseUrl = lerEnv("EVOLUTION_API_URL");
  const apiKey = lerEnv("EVOLUTION_API_KEY");
  const instance = lerEnv("EVOLUTION_INSTANCE");
  if (!baseUrl || !apiKey || !instance) {
    throw new EvolutionNotConfiguredError();
  }
  return { baseUrl, apiKey, instance };
}

export type EvolutionInstanceState = "open" | "close" | "connecting" | "unknown";

export interface EvolutionInstanceStatus {
  instanceName: string;
  state: EvolutionInstanceState;
}

export async function evolutionInstanceStatus(): Promise<EvolutionInstanceStatus> {
  const cfg = evolutionConfig();
  const res = await fetch(
    `${cfg.baseUrl}/instance/connectionState/${cfg.instance}`,
    {
      headers: { apikey: cfg.apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    }
  );
  if (!res.ok) throw new Error(`Evolution status HTTP ${res.status}`);
  const json = (await res.json()) as { instance?: { instanceName?: string; state?: EvolutionInstanceState } };
  return {
    instanceName: json.instance?.instanceName ?? cfg.instance,
    state: json.instance?.state ?? "unknown",
  };
}

export async function evolutionQRCode(): Promise<string | null> {
  const cfg = evolutionConfig();
  const res = await fetch(
    `${cfg.baseUrl}/instance/connect/${cfg.instance}`,
    {
      headers: { apikey: cfg.apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    }
  );
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Evolution QR HTTP ${res.status}`);
  }
  const json = (await res.json()) as { base64?: string; code?: string; pairingCode?: string };
  return json.base64 ?? null;
}

export async function evolutionEnviarTexto(
  destino: string,
  texto: string,
  delayMs = 0
): Promise<{ id: string; timestamp: number }> {
  const cfg = evolutionConfig();
  const res = await fetch(
    `${cfg.baseUrl}/message/sendText/${cfg.instance}`,
    {
      method: "POST",
      headers: { apikey: cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ number: destino, text: texto, delay: delayMs }),
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Evolution send HTTP ${res.status}: ${body}`);
  }
  const json = (await res.json()) as { key?: { id?: string }; messageTimestamp?: number };
  return {
    id: json.key?.id ?? "",
    timestamp: json.messageTimestamp ?? Date.now(),
  };
}

export async function evolutionCriarInstancia(instanceName: string): Promise<{ instanceName: string }> {
  const cfg = evolutionConfig();
  const res = await fetch(`${cfg.baseUrl}/instance/create`, {
    method: "POST",
    headers: { apikey: cfg.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ instanceName, qrcode: true }),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Evolution create HTTP ${res.status}: ${body}`);
  }
  const json = (await res.json()) as { instance?: { instanceName?: string } };
  return { instanceName: json.instance?.instanceName ?? instanceName };
}

export async function evolutionConfigurarWebhook(webhookUrl: string, secret?: string): Promise<void> {
  const cfg = evolutionConfig();
  const headers: Record<string, string> = {
    apikey: cfg.apiKey,
    "Content-Type": "application/json",
  };
  // Evolution permite custom header via webhookConfig; usamos para validar segredo.
  const body: Record<string, unknown> = {
    webhook: {
      enabled: true,
      url: webhookUrl,
      webhook_by_events: false,
      webhook_base64: false,
      events: ["MESSAGES_UPSERT"],
    },
  };
  if (secret) {
    body.webhook_custom_headers = [
      { name: "X-Webhook-Secret", value: secret },
    ];
  }
  const res = await fetch(`${cfg.baseUrl}/webhook/set/${cfg.instance}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const b = await res.text().catch(() => "");
    throw new Error(`Evolution webhook HTTP ${res.status}: ${b}`);
  }
}

export interface EvolutionGroup {
  id: string;
  subject: string;
  size: number;
}

/**
 * Lista os grupos do WhatsApp que a Evolution conhece.
 */
export async function evolutionListarGrupos(): Promise<EvolutionGroup[]> {
  const cfg = evolutionConfig();
  const res = await fetch(
    `${cfg.baseUrl}/group/fetchAllGroups/${cfg.instance}?getParticipants=false`,
    {
      headers: { apikey: cfg.apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    }
  );
  if (!res.ok) {
    const b = await res.text().catch(() => "");
    throw new Error(`Evolution groups HTTP ${res.status}: ${b}`);
  }
  const data = (await res.json()) as Array<{ id: string; subject: string; size?: number }>;
  return data
    .filter((g) => g?.id?.endsWith("@g.us"))
    .map((g) => ({
      id: g.id,
      subject: g.subject ?? "(sem nome)",
      size: g.size ?? 0,
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject, "pt-BR"));
}
