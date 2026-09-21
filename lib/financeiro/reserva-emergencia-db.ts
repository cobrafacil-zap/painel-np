/**
 * Operações de DB de Reserva de Emergência (#feature reserva-emergencia).
 *
 * DEPENDE de next/headers — só pode ser importado de rotas API / server
 * components. Componentes client devem importar de `reserva-emergencia.ts`
 * (que é puro).
 */

import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';

export interface DepositoReserva {
  id: string;
  valor: number;
  descricao: string | null;
  occurred_at: string;
}

export async function somaDepositos(userId: string): Promise<number> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('depositos_reserva_emergencia')
    .select('valor')
    .eq('user_id', userId);
  return (data ?? []).reduce((s, r) => s + Number(r.valor), 0);
}

export async function listDepositosRecentes(
  userId: string,
  limit: number = 10,
): Promise<DepositoReserva[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('depositos_reserva_emergencia')
    .select('id, valor, descricao, occurred_at')
    .eq('user_id', userId)
    .order('occurred_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as DepositoReserva[];
}

export async function registrarDeposito(params: {
  userId: string;
  valor: number;
  descricao?: string | null;
}): Promise<DepositoReserva | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('depositos_reserva_emergencia')
    .insert({
      user_id: params.userId,
      valor: params.valor,
      descricao: params.descricao ?? null,
    })
    .select('id, valor, descricao, occurred_at')
    .single();
  if (error || !data) return null;
  return data as DepositoReserva;
}

export async function removerDeposito(userId: string, id: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from('depositos_reserva_emergencia')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  return !error;
}

/** Busca compromissos pendentes (tipo=pagar) pra cálculo de gastos fixos */
export async function listarCompromissosPagarAtivos(userId: string) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('compromissos')
    .select('valor_total, total_parcelas, recorrencia, pago')
    .eq('user_id', userId)
    .eq('tipo', 'pagar')
    .eq('pago', false);
  return data ?? [];
}
