import { NextRequest, NextResponse } from 'next/server';
import { gerarLembretesCompromissosVencidos } from '@/lib/financeiro/lembretes-compromissos';

// Vercel Cron chama GET todo dia às 10:00 (configurado em vercel.json).
// Gera lembretes proativos pra compromisso_parcelas vencidas (#8).
// A entrega real acontece pelo cron disparar-lembretes a cada 5min.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Auth via CRON_SECRET
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const got = req.headers.get('authorization');
    if (got !== `Bearer ${expected}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const t0 = Date.now();
  const { gerados, erros } = await gerarLembretesCompromissosVencidos();
  const ms = Date.now() - t0;

  console.log(
    `[cron] lembretes-compromissos: gerados=${gerados.length} erros=${erros} ms=${ms}`,
  );

  return NextResponse.json({
    ok: true,
    gerados: gerados.length,
    erros,
    amostras: gerados.slice(0, 5).map((g) => ({
      userId: g.userId,
      parcelaId: g.parcelaId,
      descricao: g.descricao,
    })),
    ms,
  });
}
