'use client';

import { useEffect, useState } from 'react';
import { formatBRL } from '@/lib/utils';
import { Home, Receipt } from 'lucide-react';
import { useCountUp } from '@/lib/hooks/use-count-up';

interface ItemConta {
  chave: string;
  label: string;
  total: number;
  count: number;
  ultima_vez: string | null;
}

interface Resposta {
  total_mes: number;
  por_categoria: { contas_casa: number; moradia: number };
  por_item: ItemConta[];
}

const CORES: Record<string, string> = {
  aluguel: '#f97316',
  condominio: '#fb923c',
  iptu: '#fdba74',
  financiamento: '#fb923c',
  luz: '#eab308',
  agua: '#06b6d4',
  gas: '#f59e0b',
  internet: '#8b5cf6',
  telefone: '#3b82f6',
  tv: '#ec4899',
};

export function ContasMoradia({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<Resposta | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ini = new Date();
    const fim = new Date();
    const firstOfMonth = new Date(ini.getFullYear(), ini.getMonth(), 1)
      .toISOString()
      .slice(0, 10);
    const lastOfMonth = new Date(ini.getFullYear(), ini.getMonth() + 1, 0)
      .toISOString()
      .slice(0, 10);
    setLoading(true);
    fetch(`/api/financeiro/contas-moradia?from=${firstOfMonth}&to=${lastOfMonth}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  const total = data?.total_mes ?? 0;
  const totalContasCasa = data?.por_categoria?.contas_casa ?? 0;
  const totalMoradia = data?.por_categoria?.moradia ?? 0;
  const items = data?.por_item ?? [];

  const displayTotal = useCountUp(loading ? 0 : total);

  return (
    <div className="glass p-5 h-full">
      <header className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
              <Home className="w-3.5 h-3.5 text-orange-300" />
            </div>
            <p className="label-eyebrow">Contas de moradia</p>
          </div>
          <h2 className="text-lg font-semibold mt-2">Custo fixo do mês</h2>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xl sm:text-2xl font-bold num-tabular text-orange-300">
            {formatBRL(displayTotal)}
          </p>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {items.length} {items.length === 1 ? 'conta' : 'contas'}
          </p>
        </div>
      </header>

      {loading ? (
        <div className="space-y-2.5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-9 rounded-md shimmer" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <Receipt className="w-8 h-8 text-zinc-700 mb-2" />
          <p className="text-sm text-zinc-500">
            Sem contas de moradia registradas este mês.
          </p>
          <p className="text-[11px] text-zinc-600 mt-1">
            Mande <span className="text-zinc-400">&ldquo;paguei 80 de luz&rdquo;</span> ou{' '}
            <span className="text-zinc-400">&ldquo;aluguel 1200&rdquo;</span> no WhatsApp.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const cor = CORES[item.chave] ?? '#a1a1aa';
            const pct = total > 0 ? (item.total / total) * 100 : 0;
            return (
              <li key={item.chave} className="group">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <span className="text-sm text-zinc-200 truncate flex items-center gap-2">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: cor }}
                      aria-hidden
                    />
                    {item.label}
                    {item.count > 1 && (
                      <span className="text-[10px] text-zinc-600">
                        ×{item.count}
                      </span>
                    )}
                  </span>
                  <span className="text-sm num-tabular font-medium text-zinc-100 shrink-0">
                    {formatBRL(item.total)}
                  </span>
                </div>
                <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{
                      width: `${pct}%`,
                      background: cor,
                      opacity: 0.7,
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!loading && items.length > 0 && (
        <footer className="mt-4 pt-3 border-t border-white/[0.04] flex items-center justify-between text-[11px] text-zinc-500 flex-wrap gap-2">
          {totalContasCasa > 0 && (
            <span>
              Contas:{' '}
              <span className="text-zinc-300 font-medium num-tabular">
                {formatBRL(totalContasCasa)}
              </span>
            </span>
          )}
          {totalMoradia > 0 && (
            <span>
              Moradia:{' '}
              <span className="text-zinc-300 font-medium num-tabular">
                {formatBRL(totalMoradia)}
              </span>
            </span>
          )}
        </footer>
      )}
    </div>
  );
}
