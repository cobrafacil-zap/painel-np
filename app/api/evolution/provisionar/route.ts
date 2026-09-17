import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';
import { provisionarInstancia } from '@/lib/provisionamento';

/**
 * POST /api/evolution/provisionar
 *
 * Provisiona (ou retorna) a instância Evolution do usuário logado.
 * Idempotente: se já tem instance, retorna sem recriar.
 */
export async function POST() {
  const { userId } = await requireUser();

  try {
    const result = await provisionarInstancia(userId);
    if (!result.ok) {
      const status =
        result.stage === 'rpc' || result.stage === 'fetch_existing' ? 400 : 502;
      return NextResponse.json(
        { ok: false, error: result.error, stage: result.stage },
        { status }
      );
    }
    return NextResponse.json({
      ok: true,
      instanceName: result.instanceName,
      alreadyProvisioned: result.alreadyProvisioned,
      status: result.status,
    });
  } catch (e: any) {
    console.error('[evolution/provisionar]', e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'erro' },
      { status: 500 }
    );
  }
}
