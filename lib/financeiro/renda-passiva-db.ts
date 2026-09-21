/**
 * Operações de DB de renda passiva (#feature renda-passiva).
 *
 * DEPENDE de next/headers — só pode ser importado de rotas API / server
 * components. Componentes client devem importar de `renda-passiva.ts`
 * (que é puro).
 */

import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import type { Deposito } from './renda-passiva';

export async function somaDepositos(userId: string): Promise<number> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('depositos_renda_passiva')
    .select('valor')
    .eq('user_id', userId);
  return (data ?? []).reduce((s, r) => s + Number(r.valor), 0);
}

export async function listDepositosRecentes(
  userId: string,
  limit: number = 10,
): Promise<Deposito[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('depositos_renda_passiva')
    .select('id, cenario, valor, descricao, occurred_at')
    .eq('user_id', userId)
    .order('occurred_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as Deposito[];
}

export async function registrarDeposito(params: {
  userId: string;
  valor: number;
  cenario?: string;
  descricao?: string | null;
}): Promise<Deposito | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('depositos_renda_passiva')
    .insert({
      user_id: params.userId,
      valor: params.valor,
      cenario: params.cenario ?? 'independente',
      descricao: params.descricao ?? null,
    })
    .select('id, cenario, valor, descricao, occurred_at')
    .single();
  if (error || !data) return null;
  return data as Deposito;
}

export async function removerDeposito(
  userId: string,
  depositoId: string,
): Promise<boolean> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from('depositos_renda_passiva')
    .delete()
    .eq('id', depositoId)
    .eq('user_id', userId);
  return !error;
}
