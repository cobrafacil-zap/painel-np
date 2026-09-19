/**
 * Cron: limpa arquivos de áudio com >90 dias do Storage.
 *
 * Mantém row em `messages` (transcrição + sumário) mas zera
 * `audio_storage_path`. Configurar no vercel.ts:
 *
 *   crons: [{ path: '/api/cron/cleanup-audios', schedule: '0 3 * * *' }]
 *
 * Autenticação: header `Authorization: Bearer $CRON_SECRET` (mesmo
 * padrão dos outros crons do projeto).
 */
import { NextRequest, NextResponse } from 'next/server';
import { cleanupOldAudios } from '@/lib/audio-storage';

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 500 });
  }
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await cleanupOldAudios(90);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Vercel Cron usa GET por padrão; aceitamos ambos.
export const GET = POST;
