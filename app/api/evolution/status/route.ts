import { NextResponse } from 'next/server';
import { requireUser, createClient } from '@/lib/supabase/server';
import {
  evolutionInstanceStatus,
  evolutionQRCode,
  EvolutionNotConfiguredError,
} from '@/lib/evolution';

/**
 * GET /api/evolution/status
 *
 * Retorna status da instância Evolution do usuário logado.
 *
 * Se o usuário ainda não tem `evolution_instance_name`, retorna
 * `{ needsProvisioning: true }` pra UI mostrar botão de provisionar.
 *
 * Se já tem, busca status atual + QR (se não estiver 'open') e sincroniza
 * o `evolution_status` no profile.
 */
export async function GET() {
  const { userId } = await requireUser();
  const supabase = await createClient();

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('evolution_instance_name, evolution_status, evolution_owner_jid')
    .eq('id', userId)
    .single();

  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  if (!profile?.evolution_instance_name) {
    return NextResponse.json({
      needsProvisioning: true,
      instanceName: null,
      status: null,
      qr: null,
    });
  }

  try {
    const status = await evolutionInstanceStatus(profile.evolution_instance_name).catch(
      (e) => ({ instanceName: profile.evolution_instance_name!, state: 'unknown' as const, error: e?.message })
    );

    // Se a instância sumiu da Evolution (404), marca pra UI mostrar botão
    // "resetar e recriar". Causa comum: container Evolution reiniciou e
    // perdeu state, ou alguém deletou manualmente.
    if ('error' in status && status.error?.includes('HTTP 404')) {
      return NextResponse.json({
        needsProvisioning: false,
        needsRecreate: true,
        instanceName: profile.evolution_instance_name,
        status: { instanceName: profile.evolution_instance_name, state: 'unknown' },
        qr: null,
        ownerJid: null,
        error: 'Instância não encontrada na Evolution. Resete e crie uma nova.',
      });
    }

    const qr =
      status.state !== 'open'
        ? await evolutionQRCode(profile.evolution_instance_name).catch(() => null)
        : null;

    // Sincroniza status se mudou
    if (status.state !== profile.evolution_status) {
      await supabase
        .from('profiles')
        .update({ evolution_status: status.state })
        .eq('id', userId);
    }

    return NextResponse.json({
      needsProvisioning: false,
      instanceName: profile.evolution_instance_name,
      status,
      qr,
      ownerJid: profile.evolution_owner_jid ?? null,
    });
  } catch (e: any) {
    if (e instanceof EvolutionNotConfiguredError) {
      return NextResponse.json(
        { error: e.message, code: 'NOT_CONFIGURED' },
        { status: 501 }
      );
    }
    console.error('[evolution/status]', e);
    return NextResponse.json(
      { error: e?.message ?? 'erro' },
      { status: 500 }
    );
  }
}
