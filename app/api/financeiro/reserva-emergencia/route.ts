/**
 * API de Reserva de Emergência (#feature reserva-emergencia).
 *
 * GET  /api/financeiro/reserva-emergencia → {
 *   gastos_fixos_mensal, meta_reserva (×6), total_depositado,
 *   progresso_pct, completa, falta, depositos_recentes: [...]
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

  const [compromissos, total_depositado, depositos_recentes] = await Promise.all([
    listarCompromissosPagarAtivos(userId),
    somaDepositos(userId),
    listDepositosRecentes(userId, 10),
  ]);

  const gastos_fixos_mensal = calcularGastosFixosMensal(compromissos);
  const meta_reserva = calcularMetaReserva(gastos_fixos_mensal);
  const progresso = calcularProgresso(gastos_fixos_mensal, total_depositado);

  return NextResponse.json({
    gastos_fixos_mensal,
    meta_reserva,
    total_depositado: progresso.total_depositado,
    progresso_pct: Math.round(progresso.progresso_pct * 10000) / 100,
    completa: progresso.completa,
    falta: progresso.falta,
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
