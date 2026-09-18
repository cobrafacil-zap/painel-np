'use client';

import { BarsHorizontal } from '@/lib/svg/bars-horizontal';
import { formatBRL } from '@/lib/utils';

export function TopCategorias({
  data,
}: {
  data: { label: string; value: number }[];
}) {
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="glass p-5">
      <header className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="min-w-0">
          <p className="label-eyebrow">Onde o dinheiro foi</p>
          <h2 className="text-lg font-semibold mt-1">Top categorias (mês)</h2>
        </div>
        {data.length > 0 && (
          <p className="text-sm text-zinc-500 num-tabular">
            Total:{' '}
            <span className="text-zinc-300 font-medium">{formatBRL(total)}</span>
          </p>
        )}
      </header>

      <BarsHorizontal data={data} formatter={formatBRL} />
    </div>
  );
}
