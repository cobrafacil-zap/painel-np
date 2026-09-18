'use client';

import { useCountUp } from '@/lib/hooks/use-count-up';
import { Sparkline } from '@/lib/svg/sparkline';
import { formatBRL } from '@/lib/utils';

export function GraficoGastos7d({
  data,
  labels,
}: {
  data: number[];
  labels: string[];
}) {
  const total = data.reduce((s, v) => s + v, 0);
  const displayTotal = useCountUp(total);
  const max = Math.max(...data, 1);
  const hoje = data[data.length - 1] ?? 0;

  return (
    <div className="glass p-5 h-full flex flex-col">
      <header className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="min-w-0">
          <p className="label-eyebrow">Últimos 7 dias</p>
          <h2 className="text-lg font-semibold mt-1">Gastos diários</h2>
        </div>
        <div className="text-right">
          <p className="text-xl sm:text-2xl font-bold num-tabular text-red-300">
            {formatBRL(displayTotal)}
          </p>
          <p className="text-[11px] text-zinc-500 mt-0.5">acumulado</p>
        </div>
      </header>

      <div className="flex-1 flex items-center min-h-[120px]">
        <Sparkline data={data} labels={labels} color="#ef4444" height={120} />
      </div>

      <div className="flex justify-between text-[11px] text-zinc-500 mt-3 pt-3 border-t border-white/[0.04] gap-2 flex-wrap">
        <span>
          Pico:{' '}
          <span className="text-zinc-300 font-medium num-tabular">
            {formatBRL(max)}
          </span>
        </span>
        <span>
          Hoje:{' '}
          <span className="text-zinc-300 font-medium num-tabular">
            {formatBRL(hoje)}
          </span>
        </span>
      </div>
    </div>
  );
}
