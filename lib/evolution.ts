/**
 * Cliente para Evolution API (WhatsApp não-oficial, self-hosted).
 *
 * Multi-tenant: cada chamada aceita `instanceName` opcional. Se omitido,
 * usa o default `EVOLUTION_INSTANCE` da env (backward compat pro Nicolas).
 *
 * Funções que aceitam instanceName:
 *  - evolutionInstanceStatus(instanceName?)
 *  - evolutionQRCode(instanceName?)
 *  - evolutionEnviarTexto(destino, texto, delayMs?, timeoutMs?, instanceName?)
 *  - evolutionCriarInstancia(instanceName)   ← sempre explícito
 *  - evolutionConfigurarWebhook(instanceName, webhookUrl, secret?)
 *  - evolutionListarGrupos(instanceName?)
 */

export class EvolutionNotConfiguredError extends Error {
  constructor(missing: string[] = ["EVOLUTION_API_URL", "EVOLUTION_API_KEY", "EVOLUTION_INSTANCE"]) {
    super(
      `Evolution API não configurada. Defina ${missing.join(", ")} nas variáveis de ambiente.`
    );
    this.name = "EvolutionNotConfiguredError";
  }
}

function lerEnv(nome: string): string | null {
  const v = process.env[nome];
  return v && v.trim() ? v.trim() : null;
}

/**
 * Configuração global (URL + API key). Não inclui instance — agora é
 * resolvido por chamada.
 */
export function evolutionGlobalConfig() {
  const baseUrl = lerEnv("EVOLUTION_API_URL");
  const apiKey = lerEnv("EVOLUTION_API_KEY");
  const missing: string[] = [];
  if (!baseUrl) missing.push("EVOLUTION_API_URL");
  if (!apiKey) missing.push("EVOLUTION_API_KEY");
  if (missing.length > 0) throw new EvolutionNotConfiguredError(missing);
  return { baseUrl: baseUrl!, apiKey: apiKey! };
}

/**
 * DEPRECADO: use `evolutionGlobalConfig()` + passe `instanceName` por chamada.
 * Mantido para compatibilidade — retorna `{baseUrl, apiKey, instance}` onde
 * `instance` vem de EVOLUTION_INSTANCE.
 */
export function evolutionConfig() {
  const global = evolutionGlobalConfig();
  const instance = lerEnv("EVOLUTION_INSTANCE");
  if (!instance) throw new EvolutionNotConfiguredError(["EVOLUTION_INSTANCE"]);
  return { ...global, instance };
}

/** Resolve o nome da instância a usar: parâmetro explícito ou env default. */
function resolveInstance(instanceName?: string): string {
  if (instanceName && instanceName.trim()) return instanceName.trim();
  const env = lerEnv("EVOLUTION_INSTANCE");
  if (!env) throw new EvolutionNotConfiguredError(["EVOLUTION_INSTANCE"]);
  return env;
}

export type EvolutionInstanceState = "open" | "close" | "connecting" | "unknown";

export interface EvolutionInstanceStatus {
  instanceName: string;
  state: EvolutionInstanceState;
}

export async function evolutionInstanceStatus(
  instanceName?: string
): Promise<EvolutionInstanceStatus> {
  const cfg = evolutionGlobalConfig();
  const inst = resolveInstance(instanceName);
  const res = await fetch(
    `${cfg.baseUrl}/instance/connectionState/${inst}`,
    {
      headers: { apikey: cfg.apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    }
  );
  if (!res.ok) throw new Error(`Evolution status HTTP ${res.status}`);
  const json = (await res.json()) as { instance?: { instanceName?: string; state?: EvolutionInstanceState } };
  return {
    instanceName: json.instance?.instanceName ?? inst,
    state: json.instance?.state ?? "unknown",
  };
}

export async function evolutionQRCode(instanceName?: string): Promise<string | null> {
  const cfg = evolutionGlobalConfig();
  const inst = resolveInstance(instanceName);
  const res = await fetch(
    `${cfg.baseUrl}/instance/connect/${inst}`,
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
  delayMs = 0,
  timeoutMs = 45_000,
  instanceName?: string
): Promise<{ id: string; timestamp: number }> {
  const cfg = evolutionGlobalConfig();
  const inst = resolveInstance(instanceName);
  const res = await fetch(
    `${cfg.baseUrl}/message/sendText/${inst}`,
    {
      method: "POST",
      headers: { apikey: cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ number: destino, text: texto, delay: delayMs }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
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
  const cfg = evolutionGlobalConfig();
  const res = await fetch(`${cfg.baseUrl}/instance/create`, {
    method: "POST",
    headers: { apikey: cfg.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      // Evita o painel bug de "já existe" em retries
      reject_call: false,
      groups_ignore: true,
      always_online: false,
      read_messages: false,
      read_status: false,
      sync_full_history: false,
    }),
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

export async function evolutionConfigurarWebhook(
  instanceName: string,
  webhookUrl: string,
  secret?: string
): Promise<void> {
  const cfg = evolutionGlobalConfig();
  const headers: Record<string, string> = {
    apikey: cfg.apiKey,
    "Content-Type": "application/json",
  };
  // Evolution 2.3.7 do seu servidor exige payload com wrapper {webhook:{...}}
  // e snake_case (webhook_by_events, webhook_base64). Já testei camelCase/flat
  // e o servidor rejeita com 400 "instance requires property webhook".
  // ATENÇÃO: webhookBase64/webhook_base64 é SILENCIOSAMENTE ignorado por
  // essa versão da Evolution — ela devolve base64:false no GET independente
  // do que mandamos. Por isso o handler tem fallback via
  // getBase64FromMediaMessage.
  const body: Record<string, unknown> = {
    webhook: {
      enabled: true,
      url: webhookUrl,
      webhook_by_events: false,
      webhook_base64: true,
      events: ["MESSAGES_UPSERT"],
    },
  };
  if (secret) {
    body.webhook_custom_headers = [
      { name: "X-Webhook-Secret", value: secret },
    ];
  }
  const res = await fetch(`${cfg.baseUrl}/webhook/set/${instanceName}`, {
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

export async function evolutionLogout(instanceName?: string): Promise<void> {
  const cfg = evolutionGlobalConfig();
  const inst = resolveInstance(instanceName);
  const res = await fetch(`${cfg.baseUrl}/instance/logout/${inst}`, {
    method: "DELETE",
    headers: { apikey: cfg.apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok && res.status !== 404) {
    const b = await res.text().catch(() => "");
    throw new Error(`Evolution logout HTTP ${res.status}: ${b}`);
  }
}

export async function evolutionDeleteInstance(instanceName?: string): Promise<void> {
  const cfg = evolutionGlobalConfig();
  const inst = resolveInstance(instanceName);
  const res = await fetch(`${cfg.baseUrl}/instance/delete/${inst}`, {
    method: "DELETE",
    headers: { apikey: cfg.apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok && res.status !== 404) {
    const b = await res.text().catch(() => "");
    throw new Error(`Evolution delete HTTP ${res.status}: ${b}`);
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
export async function evolutionListarGrupos(instanceName?: string): Promise<EvolutionGroup[]> {
  const cfg = evolutionGlobalConfig();
  const inst = resolveInstance(instanceName);
  const res = await fetch(
    `${cfg.baseUrl}/group/fetchAllGroups/${inst}?getParticipants=false`,
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
