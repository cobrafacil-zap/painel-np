/**
 * API de renda passiva (#feature renda-passiva).
 *
 * GET  /api/financeiro/renda-passiva → {
 *   receita_media_3m, gastos_fixos_estimado, sobrinha_essencial,
 *   total_depositado (soma dos depositos_renda_passiva),
 *   depositos_recentes: [...]
 * }
 *
 * POST /api/financeiro/renda-passiva { valor, cenario?, descricao? } →
 *   registra depósito e retorna o depósito criado. Atualiza barra de
 *   progresso na UI.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, requireUser } from '@/lib/supabase/server';
import {
  registrarDeposito,
  listDepositosRecentes,
  somaDepositos,
} from '@/lib/financeiro/renda-passiva-db';

export async function GET() {
  const { userId } = await requireUser();
  const supabase = await createClient();

  // Receita média 3 meses
  const dataInicio = new Date();
  dataInicio.setDate(dataInicio.getDate() - 90);
  const dataInicioISO = dataInicio.toISOString().slice(0, 10);

  const { data: receitasData } = await supabase
    .from('records')
    .select('amount, occurred_at')
    .eq('user_id', userId)
    .eq('module_id', 'financeiro')
    .eq('type', 'receita')
    .gte('occurred_at', dataInicioISO);

  const receitas = (receitasData ?? []).map((r) => Number(r.amount));
  const receita_media_3m = receitas.length > 0
    ? Math.round((receitas.reduce((s, n) => s + n, 0) / 3) * 100) / 100
    : 0;

  // Gastos fixos: compromissos 'pagar' ativos, não pagos
  const { data: compromissosData } = await supabase
    .from('compromissos')
    .select('valor_total, total_parcelas, recorrencia, tipo, pago')
    .eq('user_id', userId)
    .eq('tipo', 'pagar')
    .eq('pago', false);

  let gastos_fixos_estimado = 0;
  for (const c of compromissosData ?? []) {
    const valorTotal = Number(c.valor_total);
    const totalParc = Number(c.total_parcelas ?? 1);
    if (totalParc <= 1) {
      gastos_fixos_estimado += valorTotal;
    } else if (c.recorrencia === 'mensal') {
      gastos_fixos_estimado += valorTotal / totalParc;
    } else if (c.recorrencia === 'semanal') {
      gastos_fixos_estimado += (valorTotal / totalParc) * 4;
    } else if (c.recorrencia === 'anual') {
      gastos_fixos_estimado += valorTotal / 12;
    }
  }
  gastos_fixos_estimado = Math.round(gastos_fixos_estimado * 100) / 100;
  const sobrinha_essencial = Math.max(0, receita_media_3m - gastos_fixos_estimado);

  // Total depositado + últimos 10
  const [total_depositado, depositos_recentes] = await Promise.all([
    somaDepositos(userId),
    listDepositosRecentes(userId, 10),
  ]);

  return NextResponse.json({
    receita_media_3m,
    gastos_fixos_estimado,
    sobrinha_essencial: Math.round(sobrinha_essencial * 100) / 100,
    samples_receita: receitas.length,
    compromissos_ativos: (compromissosData ?? []).length,
    total_depositado: Math.round(total_depositado * 100) / 100,
    depositos_recentes,
  });
}

interface PostBody {
  valor: number;
  cenario?: string;
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
  if (body.cenario && !['conservador', 'moderado', 'agressivo', 'cripto', 'independente'].includes(body.cenario)) {
    return NextResponse.json({ error: 'cenario_invalido' }, { status: 400 });
  }

  const deposito = await registrarDeposito({
    userId,
    valor: body.valor,
    cenario: body.cenario,
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
