import { NextRequest, NextResponse } from 'next/server';
import { jobCalcularPadroes } from '@/lib/financeiro/patterns';

// Roda diariamente. Atualiza tabela user_patterns com base nos últimos 90 dias.
// Idempotente.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  // Cron auth (Vercel injeta Authorization: Bearer <CRON_SECRET>)
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  try {
    const result = await jobCalcularPadroes();
    return NextResponse.json({
      ok: true,
      duration_ms: Date.now() - start,
      ...result,
    });
  } catch (e: any) {
    console.error('[cron calcular-padroes] error:', e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'desconhecido' },
      { status: 500 }
    );
  }
}
