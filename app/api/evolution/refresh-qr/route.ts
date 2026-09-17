import { NextResponse } from 'next/server';
import { requireUser, createClient } from '@/lib/supabase/server';
import { evolutionQRCode } from '@/lib/evolution';

/**
 * POST /api/evolution/refresh-qr
 *
 * Força a Evolution a gerar um QR novo. Útil quando:
 *  - O QR atual expirou (Evolution gera QR com TTL curto, ~60s)
 *  - O polling de 3s está demorando pra pegar o próximo
 *  - O user errou o scan e quer tentar de novo sem esperar
 *
 * Retorna: { qr: 'data:image/png;base64,...' } ou erro.
 */
export async function POST() {
  const { userId } = await requireUser();
  const supabase = await createClient();

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('evolution_instance_name')
    .eq('id', userId)
    .single();

  if (profileErr || !profile?.evolution_instance_name) {
    return NextResponse.json(
      { error: 'Sem instância vinculada' },
      { status: 400 }
    );
  }

  try {
    const qr = await evolutionQRCode(profile.evolution_instance_name);
    if (!qr) {
      return NextResponse.json(
        { error: 'Evolution não retornou QR (instância pode estar já conectada)' },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, qr, instanceName: profile.evolution_instance_name });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'erro' }, { status: 500 });
  }
}
