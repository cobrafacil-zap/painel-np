/**
 * API de histórico de refeições (#feature cuidado pessoal).
 *
 * GET /api/cuidado-pessoal/historico?dias=14  → lista paginada de refeições
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const dias = Math.min(Math.max(parseInt(searchParams.get('dias') ?? '14'), 1), 90);

  // Limita por período pra não carregar tudo
  const dataInicio = new Date();
  dataInicio.setDate(dataInicio.getDate() - dias);

  // Lista todas do período (limite razoável). Não faz JOIN com messages
  // pra evitar dependência de FK que nem sempre tá no schema — só pegamos
  // o image_storage_path por ID em batch separado se quisermos.
  const { data: rows, error } = await supabase
    .from('refeicoes')
    .select('id, occurred_at, meal_type, kcal, protein_g, carb_g, fat_g, itens, confidence, descricao_user')
    .eq('user_id', user.id)
    .eq('ativa', true)
    .gte('occurred_at', dataInicio.toISOString())
    .order('occurred_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('[historico_refeicoes]', error);
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
  }

  return NextResponse.json({
    refeicoes: rows ?? [],
    dias,
  });
}
