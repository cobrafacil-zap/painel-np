import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatBRL, monthISO, startOfMonthISO, endOfMonthISO } from '@/lib/utils';
import { Wallet } from 'lucide-react';

export default async function PainelPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const inicio = startOfMonthISO();
  const fim = endOfMonthISO();

  // Resumo rápido do mês
  const { data: recs } = await supabase
    .from('records')
    .select('type, amount')
    .eq('user_id', user.id)
    .eq('module_id', 'financeiro')
    .gte('occurred_at', inicio)
    .lte('occurred_at', fim);

  const receitas = (recs ?? []).filter((r: any) => r.type === 'receita').reduce((s: number, r: any) => s + Number(r.amount), 0);
  const gastos = (recs ?? []).filter((r: any) => r.type === 'gasto').reduce((s: number, r: any) => s + Number(r.amount), 0);
  const saldo = receitas - gastos;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Visão geral</h1>
        <p className="text-sm text-zinc-500 mt-1">
          {new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card">
          <p className="text-xs text-zinc-500">Receitas (mês)</p>
          <p className="text-2xl font-semibold mt-1 text-emerald-300">{formatBRL(receitas)}</p>
        </div>
        <div className="card">
          <p className="text-xs text-zinc-500">Gastos (mês)</p>
          <p className="text-2xl font-semibold mt-1 text-red-300">{formatBRL(gastos)}</p>
        </div>
        <div className="card">
          <p className="text-xs text-zinc-500">Saldo (mês)</p>
          <p className={`text-2xl font-semibold mt-1 ${saldo >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
            {formatBRL(saldo)}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/financeiro" className="card hover:bg-bg-elevated transition-colors">
          <div className="flex items-start gap-3">
            <Wallet className="w-5 h-5 text-emerald-400 mt-0.5" />
            <div>
              <h2 className="font-semibold">Financeiro</h2>
              <p className="text-sm text-zinc-500 mt-1">
                Lançamentos, gráficos, orçamento e integração com WhatsApp.
              </p>
            </div>
          </div>
        </Link>
        <div className="card opacity-50">
          <h2 className="font-semibold">Treino</h2>
          <p className="text-sm text-zinc-500 mt-1">Em breve.</p>
        </div>
      </div>
    </div>
  );
}
