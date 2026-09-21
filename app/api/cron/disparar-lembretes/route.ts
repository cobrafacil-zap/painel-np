import { NextRequest, NextResponse } from 'next/server';
import {
  gerarLembretesAtraso,
  dispararLembretesVencidos,
} from '@/modules/tarefas/lib/lembretes';
import { gerarRelatoriosDiarios } from '@/lib/financeiro/relatorio-diario';
import { cleanupOldAudios } from '@/lib/audio-storage';

/**
 * Cron consolidado (#fix plano Hobby).
 *
 * Vercel plano Free/Hobby limita a 2 crons por dia. Antes tinha 7
 * registrados no vercel.json — só 2 rodavam de fato (este +
 * cleanup-audios). Os outros 5 ficavam pendurados.
 *
 * Solução: este cron roda cada 5min. A cada execução, checa a hora
 * atual em BRT e dispara os jobs agendados pra aquele horário:
 *
 *   04:00 BRT → calcular-padroes
 *   10:00 BRT → lembretes-compromissos
 *   17:00 BRT → relatorio-diario slot=17h
 *   23:00 BRT → relatorio-diario slot=23h
 *   dia 1, 09:00 BRT → insights-mensais (TODO: implementar)
 *
 * Cada job é idempotente, então não duplica se cair em 2 chamadas
 * próximas do mesmo horário. Margem de 5min pra cobrir drift do cron.
 */

const JANELA_MINUTOS = 5; // margem pra drift

function horaEmBRT(): { hora: number; minuto: number; dia: number; mes: number } {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  return {
    hora: get('hour'),
    minuto: get('minute'),
    dia: get('day'),
    mes: get('month'),
  };
}

function bateuJanela(horaAlvo: number, atual: { hora: number; minuto: number }): boolean {
  // Janela de 5min centrada no alvo. ex: alvo 17:00 → dispara entre 17:00 e 17:04.
  const minutosAlvo = horaAlvo * 60;
  const minutosAtuais = atual.hora * 60 + atual.minuto;
  return minutosAtuais >= minutosAlvo && minutosAtuais < minutosAlvo + JANELA_MINUTOS;
}

// Vercel Cron chama GET a cada 5 minutos.
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
  const brazil = horaEmBRT();
  const jobsDisparados: string[] = [];

  // 1. Tarefas: sempre (cada 5min) — gerar atrasos + disparar vencidos.
  const gerados = await gerarLembretesAtraso();
  const { disparados, erros, desistidos } = await dispararLembretesVencidos();

  // 2. Jobs agendados por horário (consolidação)
  try {
    if (bateuJanela(3, brazil)) {
      const r = await cleanupOldAudios(90);
      jobsDisparados.push(`cleanup_audios(arquivos=${r.arquivosApagados},rows=${r.rowsAtualizadas})`);
    }
    if (bateuJanela(17, brazil)) {
      const r = await gerarRelatoriosDiarios('17h');
      jobsDisparados.push(`relatorio_17h(gerados=${r.gerados.length},erros=${r.erros})`);
    }
    if (bateuJanela(23, brazil)) {
      const r = await gerarRelatoriosDiarios('23h');
      jobsDisparados.push(`relatorio_23h(gerados=${r.gerados.length},erros=${r.erros})`);
    }
    // calcular-padroes + lembretes-compromissos são jobs menos críticos
    // (calculam padrões/cached e mandam lembretes de contas). Como só
    // temos 2 slots de cron (Free), priorizo: tarefas + relatórios.
  } catch (e) {
    console.warn('[cron] job consolidado falhou:', e);
  }

  const ms = Date.now() - t0;
  console.log(
    `[cron] ${brazil.hora}:${String(brazil.minuto).padStart(2, '0')} BRT — ` +
      `tarefas: gerados=${gerados} disparados=${disparados} erros=${erros}; ` +
      `jobs: [${jobsDisparados.join(', ')}]; ms=${ms}`,
  );

  return NextResponse.json({
    ok: true,
    brt: `${brazil.hora}:${String(brazil.minuto).padStart(2, '0')}`,
    tarefas: { gerados, disparados, erros, desistidos },
    jobs_extras: jobsDisparados,
    ms,
  });
}
