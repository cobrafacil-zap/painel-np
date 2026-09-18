'use client';

import { useEffect, useState } from 'react';
import { formatBRL } from '@/lib/utils';
import { Target, Trophy } from 'lucide-react';
import { useCountUp } from '@/lib/hooks/use-count-up';

interface Budget {
  id: string;
  category_slug: string;
  amount: number;
  period: string;
}

interface BudgetProgress extends Budget {
  spent: number;
  pct: number;
  remaining: number;
}

export function MetasMes() {
  const [budgets, setBudgets] = useState<Budget[] | null>(null);
  const [progress, setProgress] = useState<BudgetProgress[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const period = new Date().toISOString().slice(0, 7); // YYYY-MM
    Promise.all([
      fetch(`/api/financeiro/orcamentos?period=${period}`).then((r) => r.json()),
      fetch(
        `/api/financeiro/lancamentos?type=gasto&from=${period}-01&limit=1000`,
      ).then((r) => r.json()),
    ])
      .then(([b, r]) => {
        const bs = b.budgets ?? [];
        const records = r.records ?? [];
        const ps: BudgetProgress[] = bs.map((budget: Budget) => {
          const spent = records
            .filter((rec: any) => rec.category === budget.category_slug)
            .reduce((s: number, rec: any) => s + Number(rec.amount), 0);
          const amount = Number(budget.amount);
          return {
            ...budget,
            spent,
            pct: amount > 0 ? Math.round((spent / amount) * 100) : 0,
            remaining: amount - spent,
          };
        });
        setBudgets(bs);
        setProgress(ps.sort((a, b) => b.pct - a.pct));
      })
      .catch(() => setProgress([]))
      .finally(() => setLoading(false));
  }, []);

  const totalBudget = (progress ?? []).reduce((s, b) => s + Number(b.amount), 0);
  const totalSpent = (progress ?? []).reduce((s, b) => s + b.spent, 0);
  const displayBudget = useCountUp(loading ? 0 : totalBudget);
  const displaySpent = useCountUp(loading ? 0 : totalSpent);

  if (loading) {
    return (
      <div className="glass p-5 h-full">
        <div className="space-y-3">
          <div className="h-5 w-32 rounded shimmer" />
          <div className="h-8 w-24 rounded shimmer" />
          <div className="space-y-2 mt-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 rounded-md shimmer" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const list = progress ?? [];

  if (list.length === 0) {
    return (
      <div className="glass p-5 h-full flex flex-col items-center justify-center text-center py-8">
        <Target className="w-8 h-8 text-zinc-700 mb-2" />
        <p className="text-sm text-zinc-400">Nenhuma meta definida pra este mês.</p>
        <p className="text-[11px] text-zinc-600 mt-1">
          Manda &ldquo;definir meta de 600 pra mercado&rdquo; no WhatsApp.
        </p>
      </div>
    );
  }

  return (
    <div className="glass p-5 h-full">
      <header className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
              <Trophy className="w-3.5 h-3.5 text-amber-300" />
            </div>
            <p className="label-eyebrow">Metas do mês</p>
          </div>
          <h2 className="text-lg font-semibold mt-2">Orçamentos</h2>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xl sm:text-2xl font-bold num-tabular text-zinc-100">
            {formatBRL(displaySpent)}
            <span className="text-zinc-500 text-sm font-normal">
              {' '}/ {formatBRL(displayBudget)}
            </span>
          </p>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {list.length} meta{list.length !== 1 ? 's' : ''} ativa
            {list.length !== 1 ? 's' : ''}
          </p>
        </div>
      </header>

      <ul className="space-y-2.5">
        {list.slice(0, 6).map((b) => {
          const cor =
            b.pct > 100
              ? 'bg-red-500'
              : b.pct >= 80
                ? 'bg-amber-500'
                : 'bg-emerald-500';
          const textoCor =
            b.pct > 100
              ? 'text-red-300'
              : b.pct >= 80
                ? 'text-amber-300'
                : 'text-emerald-300';
          return (
            <li key={b.id} className="space-y-1">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-zinc-200 truncate">{b.category_slug}</span>
                <span className="num-tabular text-zinc-400 shrink-0 text-xs">
                  {formatBRL(b.spent)} / {formatBRL(Number(b.amount))}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                <div
                  className={`h-full ${cor} transition-all`}
                  style={{ width: `${Math.min(100, b.pct)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px]">
                <span className={textoCor}>{b.pct}%</span>
                <span className="text-zinc-600">
                  {b.remaining >= 0
                    ? `sobra ${formatBRL(b.remaining)}`
                    : `estourou ${formatBRL(-b.remaining)}`}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
