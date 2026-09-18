'use client';

import { Heatmap } from '@/lib/svg/heatmap';
import { formatBRL } from '@/lib/utils';

export function HeatmapAtividade({
  data,
}: {
  data: { dia: string; valor: number }[];
}) {
  const total = data.reduce((s, d) => s + d.valor, 0);
  const ativos = data.filter((d) => d.valor > 0).length;

  return (
    <div className="glass p-5 h-full">
      <header className="flex items-start justify-between mb-4">
        <div>
          <p className="label-eyebrow">Atividade</p>
          <h2 className="text-lg font-semibold mt-1">Gastos — 4 semanas</h2>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold num-tabular text-zinc-100">
            {formatBRL(total)}
          </p>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {ativos} dia{ativos !== 1 ? 's' : ''} com gasto
          </p>
        </div>
      </header>

      <div className="flex justify-center sm:justify-start">
        <Heatmap data={data} weeks={6} cellSize={16} gap={4} color="#22c55e" />
      </div>
    </div>
  );
}
