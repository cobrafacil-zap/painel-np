import { NextRequest, NextResponse } from 'next/server';
import { gerarRelatoriosDiarios } from '@/lib/financeiro/relatorio-diario';

// Vercel Cron chama 2x ao dia (17:00 e 23:00). Gera 1 lembrete WhatsApp
// por user ativo com resumo parcial/final do dia.
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

  // Detecta slot pelo horário em SP (Vercel cron roda em UTC; GRU1 = UTC-3).
  // 17h local = 20h UTC; 23h local = 02h UTC (do dia seguinte). Mas o
  // Vercel cron de expressão "0 17,23 * * *" usa UTC também. A gente
  // decide pelo `Date.now()` da request (que pode estar em UTC) e mapeia.
  // Estratégia mais simples: schedule separado em vercel.json — 0 20 e 0 2
  // UTC, equivalentes a 17h e 23h local.
  const slot: '17h' | '23h' =
    req.headers.get('x-vercel-cron')?.includes('relatorio-17h') ||
    req.nextUrl.searchParams.get('slot') === '17h'
      ? '17h'
      : '23h';

  const t0 = Date.now();
  const { gerados, erros } = await gerarRelatoriosDiarios(slot);
  const ms = Date.now() - t0;

  console.log(`[cron] relatorio-diario ${slot}: gerados=${gerados.length} erros=${erros} ms=${ms}`);

  return NextResponse.json({
    ok: true,
    slot,
    gerados: gerados.length,
    erros,
    ms,
  });
}
