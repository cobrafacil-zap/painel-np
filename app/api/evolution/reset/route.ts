import { NextResponse } from 'next/server';
import { requireUser, createServiceClient } from '@/lib/supabase/server';
import {
  evolutionLogout,
  evolutionDeleteInstance,
  evolutionInstanceStatus,
} from '@/lib/evolution';

/**
 * POST /api/evolution/reset
 *
 * Reseta a instância do user logado. Usado quando a Evolution perdeu a
 * instância (delete manual, restart do container, corrupção de sessão) mas
 * o profile ainda aponta pra um nome que não existe mais — daí o painel
 * mostra 404 ao buscar status e o user não consegue reconectar pelo QR.
 *
 * Comportamento:
 *  1. Logout + delete da Evolution (best-effort, ignora 404)
 *  2. Limpa evolution_instance_name, evolution_status, evolution_owner_jid
 *     no profile → profile volta a estado "precisa provisionar"
 *  3. Front-end redireciona pro onboarding, que recria a instância
 *     com nome novo.
 *
 * ATENÇÃO: essa rota é destrutiva. Disparar WhatsApp não vai funcionar
 * até o user escanear o QR novo.
 */
export async function POST() {
  const { userId } = await requireUser();
  const supabase = createServiceClient();

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('evolution_instance_name, evolution_status')
    .eq('id', userId)
    .single();

  if (profileErr || !profile) {
    return NextResponse.json({ error: profileErr?.message ?? 'profile not found' }, { status: 500 });
  }

  const instanceName = profile.evolution_instance_name;
  const results: Record<string, unknown> = {};

  if (instanceName) {
    // Tenta logout (best-effort: se já não existir, ignora 404)
    try {
      await evolutionLogout(instanceName);
      results.logout = 'ok';
    } catch (e: any) {
      results.logout = `skipped: ${e?.message ?? 'unknown'}`;
    }

    // Tenta delete (best-effort)
    try {
      await evolutionDeleteInstance(instanceName);
      results.delete = 'ok';
    } catch (e: any) {
      results.delete = `skipped: ${e?.message ?? 'unknown'}`;
    }
  }

  // Limpa o profile — volta pro estado "precisa provisionar"
  const { error: updateErr } = await supabase
    .from('profiles')
    .update({
      evolution_instance_name: null,
      evolution_status: 'pending',
      evolution_owner_jid: null,
    })
    .eq('id', userId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message, results }, { status: 500 });
  }

  return NextResponse.json({ ok: true, results });
}
