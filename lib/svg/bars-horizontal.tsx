'use client';

import { useEffect, useState } from 'react';

/**
 * Barras horizontais com animação de width (CSS transition).
 *
 * @example
 *   <BarsHorizontal
 *     data={[{ label: 'Mercado', value: 850 }, { label: 'Uber', value: 320 }]}
 *     formatter={formatBRL}
 *   />
 */
export function BarsHorizontal({
  data,
  formatter,
  colors = ['#22c55e', '#f59e0b', '#3b82f6', '#a855f7', '#ef4444'],
}: {
  data: { label: string; value: number }[];
  formatter?: (v: number) => string;
  colors?: string[];
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const total = data.reduce((s, d) => s + d.value, 0);
  const [mounted, setMounted] = useState(false);

  // Dispara animação só após mount (assim a transição roda)
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 60);
    return () => clearTimeout(t);
  }, []);

  if (data.length === 0) {
    return <div className="text-xs text-zinc-500">Sem dados no período.</div>;
  }

  return (
    <div className="space-y-2.5">
      {data.map((d, i) => {
        const pct = (d.value / max) * 100;
        const totalPct = total > 0 ? (d.value / total) * 100 : 0;
        return (
          <div key={d.label} className="group">
            <div className="flex justify-between text-xs mb-1 tabular-nums">
              <span className="text-zinc-300 truncate">{d.label}</span>
              <span className="text-zinc-400 ml-2 shrink-0">
                {formatter ? formatter(d.value) : d.value}
                <span className="text-zinc-600 ml-1">({totalPct.toFixed(0)}%)</span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: mounted ? `${pct}%` : '0%',
                  background: colors[i % colors.length],
                  transition: 'width 800ms cubic-bezier(0.22, 1, 0.36, 1)',
                  boxShadow: `0 0 12px ${colors[i % colors.length]}55`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
