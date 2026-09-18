import { NextRequest, NextResponse } from 'next/server';
import {
  gerarLembretesAtraso,
  dispararLembretesVencidos,
} from '@/modules/tarefas/lib/lembretes';

// Vercel Cron chama GET a cada 5 minutos (configurado em vercel.json).
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Auth: Vercel envia o header Authorization quando CRON_SECRET está
  // configurado no projeto. Sem header válido → 401.
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const got = req.headers.get('authorization');
    if (got !== `Bearer ${expected}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const t0 = Date.now();
  const gerados = await gerarLembretesAtraso();
  const { disparados, erros, desistidos } = await dispararLembretesVencidos();
  const ms = Date.now() - t0;

  console.log(
    `[cron] lembrar-tarefas: gerados_atraso=${gerados} disparados=${disparados} erros=${erros} desistidos=${desistidos} ms=${ms}`
  );

  return NextResponse.json({
    ok: true,
    gerados_atraso: gerados,
    disparados,
    erros,
    desistidos,
    ms,
  });
}
