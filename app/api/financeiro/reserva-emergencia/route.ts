/**
 * API de Reserva de Emergência (#feature reserva-emergencia).
 *
 * GET  /api/financeiro/reserva-emergencia → {
 *   gastos_fixos_mensal, meta_reserva (×6), total_depositado,
 *   progresso_pct, completa, falta, fase,
 *   rendimento_mensal_estimado (se rendendo),
 *   sobrinha_estimada (receita_media_3m − gastos_fixos),
 *   depositos_recentes: [...]
 * }
 *
 * POST /api/financeiro/reserva-emergencia { valor, descricao? } →
 *   registra depósito. Retorna total atualizado.
 *
 * DELETE /api/financeiro/reserva-emergencia/[id] → remove depósito.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, requireUser } from '@/lib/supabase/server';
import {
  calcularGastosFixosMensal,
  calcularMetaReserva,
  calcularProgresso,
} from '@/lib/financeiro/reserva-emergencia';
import {
  listarCompromissosPagarAtivos,
  listDepositosRecentes,
  registrarDeposito,
  somaDepositos,
} from '@/lib/financeiro/reserva-emergencia-db';

export async function GET() {
  const { userId } = await requireUser();
  const supabase = await createClient();

  const [compromissos, total_depositado, depositos_recentes] = await Promise.all([
    listarCompromissosPagarAtivos(userId),
    somaDepositos(userId),
    listDepositosRecentes(userId, 10),
  ]);

  const gastos_fixos_mensal = calcularGastosFixosMensal(compromissos);
  const meta_reserva = calcularMetaReserva(gastos_fixos_mensal);
  const progresso = calcularProgresso(gastos_fixos_mensal, total_depositado);

  // Receita média 3 meses (mesma lógica da renda-passiva) → sobrinha
  const dataInicio = new Date();
  dataInicio.setDate(dataInicio.getDate() - 90);
  const dataInicioISO = dataInicio.toISOString().slice(0, 10);

  const { data: receitasData } = await supabase
    .from('records')
    .select('amount')
    .eq('user_id', userId)
    .eq('module_id', 'financeiro')
    .eq('type', 'receita')
    .gte('occurred_at', dataInicioISO);

  const receitas = (receitasData ?? []).map((r) => Number(r.amount));
  const receita_media_3m = receitas.length > 0
    ? Math.round((receitas.reduce((s, n) => s + n, 0) / 3) * 100) / 100
    : 0;
  const sobrinha_estimada = Math.max(
    0,
    Math.round((receita_media_3m - gastos_fixos_mensal) * 100) / 100,
  );

  return NextResponse.json({
    gastos_fixos_mensal,
    meta_reserva,
    total_depositado: progresso.total_depositado,
    progresso_pct: Math.round(progresso.progresso_pct * 10000) / 100,
    completa: progresso.completa,
    falta: progresso.falta,
    fase: progresso.fase,
    rendimento_mensal_estimado: progresso.rendimento_mensal_estimado,
    receita_media_3m,
    sobrinha_estimada,
    compromissos_ativos: compromissos.length,
    depositos_recentes,
  });
}

interface PostBody {
  valor: number;
  descricao?: string | null;
}

export async function POST(req: NextRequest) {
  const { userId } = await requireUser();
  let body: PostBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (typeof body.valor !== 'number' || body.valor <= 0) {
    return NextResponse.json({ error: 'valor_invalido' }, { status: 400 });
  }

  const deposito = await registrarDeposito({
    userId,
    valor: body.valor,
    descricao: body.descricao ?? null,
  });

  if (!deposito) {
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }

  const novoTotal = await somaDepositos(userId);
  return NextResponse.json({
    ok: true,
    deposito,
    total_depositado: Math.round(novoTotal * 100) / 100,
  });
}
