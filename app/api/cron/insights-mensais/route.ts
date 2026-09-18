import { NextRequest, NextResponse } from 'next/server';
import { gerarInsightsMesAnterior } from '@/lib/financeiro/insights-mensais';

// Vercel Cron chama GET dia 1 de cada mês às 09:00 (configurado em vercel.json).
// Gera 1 lembrete WhatsApp por user ativo com resumo do mês anterior.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const got = req.headers.get('authorization');
    if (got !== `Bearer ${expected}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const t0 = Date.now();
  const { gerados, erros } = await gerarInsightsMesAnterior();
  const ms = Date.now() - t0;

  console.log(`[cron] insights-mensais: gerados=${gerados.length} erros=${erros} ms=${ms}`);

  return NextResponse.json({
    ok: true,
    gerados: gerados.length,
    erros,
    amostras: gerados.slice(0, 3).map((g) => ({
      userId: g.userId,
      periodo: g.periodo,
    })),
    ms,
  });
}
