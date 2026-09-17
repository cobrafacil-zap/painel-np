/**
 * Provisionamento automático de instância Evolution API por usuário.
 *
 * Fluxo:
 *  1. Gerar nome único via RPC (`gen_evolution_instance_name()`).
 *  2. Persistir nome no profile ANTES de criar na Evolution (idempotência:
 *     se cair no meio do provisionamento, retry pega o mesmo nome).
 *  3. Criar instância na Evolution (gera QR).
 *  4. Apontar webhook da instância pra URL do painel, com X-Webhook-Secret.
 *  5. Marcar status = 'qr' no DB.
 *
 * Se o usuário JÁ tem `evolution_instance_name` no profile, retorna o
 * existente sem recriar (idempotente).
 */

import { createServiceClient } from '@/lib/supabase/server';
import {
  evolutionCriarInstancia,
  evolutionConfigurarWebhook,
  evolutionInstanceStatus,
  type EvolutionInstanceStatus,
} from '@/lib/evolution';

export type ProvisionarResult =
  | { ok: true; instanceName: string; alreadyProvisioned: boolean; status: EvolutionInstanceStatus }
  | { ok: false; error: string; stage: 'rpc' | 'persist' | 'create' | 'webhook' | 'fetch_existing' };

export async function provisionarInstancia(userId: string): Promise<ProvisionarResult> {
  const supabase = createServiceClient();

  // 0. Verifica se já existe — idempotência
  const { data: existing, error: existingErr } = await supabase
    .from('profiles')
    .select('evolution_instance_name, evolution_status')
    .eq('id', userId)
    .maybeSingle();

  if (existingErr) {
    return { ok: false, error: existingErr.message, stage: 'fetch_existing' };
  }

  if (existing?.evolution_instance_name) {
    // Se está como 'pending', o provisionamento anterior falhou no meio —
    // forçar reprocessamento em vez de marcar como já provisionado.
    if (existing.evolution_status !== 'pending') {
      const status = await evolutionInstanceStatus(existing.evolution_instance_name).catch(
        () => ({ instanceName: existing.evolution_instance_name!, state: 'unknown' as const })
      );
      return {
        ok: true,
        instanceName: existing.evolution_instance_name,
        alreadyProvisioned: true,
        status,
      };
    }
    // 'pending' no banco → cai pra reprovisionar abaixo (reusa o nome)
  }

  // 1. Gerar nome único via RPC
  const { data: nomeData, error: rpcErr } = await supabase.rpc('gen_evolution_instance_name');
  if (rpcErr || !nomeData) {
    return { ok: false, error: rpcErr?.message ?? 'Falha ao gerar nome', stage: 'rpc' };
  }
  const instanceName = nomeData as string;

  // 2. Persistir ANTES de criar (idempotência no retry)
  const { error: persistErr } = await supabase
    .from('profiles')
    .update({
      evolution_instance_name: instanceName,
      evolution_status: 'pending',
      evolution_created_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (persistErr) {
    return { ok: false, error: persistErr.message, stage: 'persist' };
  }

  // 3. Criar na Evolution
  try {
    await evolutionCriarInstancia(instanceName);
  } catch (e: any) {
    // Se falhar aqui, deixa o profile com o nome setado pra permitir retry manual
    // (admin pode ver no log que a instância ficou "pending" mas não existe na Evolution)
    return { ok: false, error: e?.message ?? 'Falha ao criar instância', stage: 'create' };
  }

  // 4. Apontar webhook
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) {
    return { ok: false, error: 'NEXT_PUBLIC_APP_URL não definida', stage: 'webhook' };
  }
  const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/whatsapp/webhook`;
  const secret = process.env.WEBHOOK_SECRET;

  try {
    await evolutionConfigurarWebhook(instanceName, webhookUrl, secret);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Falha ao configurar webhook', stage: 'webhook' };
  }

  // 5. Status = qr (Evolution acabou de gerar)
  await supabase
    .from('profiles')
    .update({ evolution_status: 'qr' })
    .eq('id', userId);

  return {
    ok: true,
    instanceName,
    alreadyProvisioned: false,
    status: { instanceName, state: 'connecting' },
  };
}
