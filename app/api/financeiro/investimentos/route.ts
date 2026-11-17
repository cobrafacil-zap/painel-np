/**
 * API de investimentos por categoria (reserva | imobiliario | acoes).
 *
 * GET  /api/financeiro/investimentos → {
 *   totais: { reserva, imobiliario, acoes },
 *   depositos: [{ id, categoria, valor, descricao, occurred_at }]
 * }
 *
 * POST /api/financeiro/investimentos { categoria, valor, descricao? } →
 *   registra aporte e retorna o depósito criado.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';
import type { CategoriaInvestimento } from '@/lib/financeiro/investimentos';
import {
  getTotaisPorCategoria,
  listarDepositos,
  registrarDeposito,
} from '@/lib/financeiro/investimentos-db';

const CATEGORIAS: CategoriaInvestimento[] = ['reserva', 'imobiliario', 'acoes'];

export async function GET() {
  const { userId } = await requireUser();
  const [totais, depositos] = await Promise.all([
    getTotaisPorCategoria(userId),
    listarDepositos(userId, 100),
  ]);
  return NextResponse.json({ totais, depositos });
}

interface PostBody {
  categoria?: string;
  valor?: number;
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

  if (!body.categoria || !CATEGORIAS.includes(body.categoria as CategoriaInvestimento)) {
    return NextResponse.json({ error: 'categoria_invalida' }, { status: 400 });
  }
  if (typeof body.valor !== 'number' || body.valor <= 0) {
    return NextResponse.json({ error: 'valor_invalido' }, { status: 400 });
  }

  const deposito = await registrarDeposito({
    userId,
    categoria: body.categoria as CategoriaInvestimento,
    valor: body.valor,
    descricao: body.descricao ?? null,
  });

  if (!deposito) {
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deposito }, { status: 201 });
}
