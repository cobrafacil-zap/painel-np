'use client';

import { useCountUp } from '@/lib/hooks/use-count-up';
import { RingProgress } from '@/lib/svg/ring-progress';
import { formatBRL } from '@/lib/utils';

function corPorPercent(pct: number): string {
  if (pct < 80) return '#22c55e'; // emerald-500 — tranquilo
  if (pct <= 100) return '#f59e0b'; // amber-500 — atenção
  return '#ef4444'; // red-500 — estourou
}

function labelPorPercent(pct: number): string {
  if (pct < 80) return '🟢 tranquilo';
  if (pct <= 100) return '🟡 atenção';
  return '🔴 estourou';
}

export function HeroSaldo({
  receitas,
  gastos,
  saldo,
  metaDiaria,
  gastoHoje,
}: {
  receitas: number;
  gastos: number;
  saldo: number;
  metaDiaria?: number | null;
  gastoHoje?: number;
}) {
  const total = receitas + gastos;
  const percentGastos = total > 0 ? (gastos / total) * 100 : 0;

  const displayReceitas = useCountUp(receitas);
  const displayGastos = useCountUp(gastos);
  const displaySaldo = useCountUp(saldo);

  const saldoColor =
    saldo > 0
      ? 'text-emerald-300'
      : saldo < 0
        ? 'text-red-300'
        : 'text-zinc-300';

  // Meta diária: se não tiver definida, não renderiza o ring.
  const temMeta = typeof metaDiaria === 'number' && metaDiaria > 0;
  const pctMeta = temMeta
    ? Math.min(150, ((gastoHoje ?? 0) / metaDiaria!) * 100)
    : 0;
  const displayPctMeta = useCountUp(Math.round(pctMeta));

  return (
    <div className="glass-elevated p-5 sm:p-6 md:p-8 relative overflow-hidden">
      <div
        className={`relative grid grid-cols-1 items-center gap-5 md:gap-10 ${
          temMeta ? 'md:grid-cols-[auto_1fr_auto]' : 'md:grid-cols-[auto_1fr]'
        }`}
      >
        {/* Ring SVG — gasto do mês */}
        <div className="flex justify-center md:justify-start">
          <div className="block md:hidden">
            <RingProgress
              percent={percentGastos}
              size={140}
              stroke={11}
              color="#22c55e"
              label={`${percentGastos.toFixed(0)}%`}
              sublabel="gasto"
            />
          </div>
          <div className="hidden md:block">
            <RingProgress
              percent={percentGastos}
              size={200}
              stroke={14}
              color="#22c55e"
              label={`${percentGastos.toFixed(0)}%`}
              sublabel="gasto"
            />
          </div>
        </div>

        {/* Saldo + breakdown */}
        <div className="min-w-0">
          <p className="label-eyebrow">Saldo do mês</p>
          <p
            className={`text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight num-tabular mt-2 ${saldoColor}`}
          >
            {formatBRL(displaySaldo)}
          </p>

          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-x-6 gap-y-1.5 mt-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
              <span className="text-zinc-400">Receitas</span>
              <span className="text-emerald-300 font-semibold num-tabular">
                +{formatBRL(displayReceitas)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
              <span className="text-zinc-400">Gastos</span>
              <span className="text-red-300 font-semibold num-tabular">
                −{formatBRL(displayGastos)}
              </span>
            </div>
          </div>
        </div>

        {/* Mini-ring de meta diária (desktop only por enquanto) */}
        {temMeta && (
          <>
            {/* Desktop: terceira coluna do grid */}
            <div className="hidden md:flex flex-col items-center gap-2 pl-6 border-l border-white/[0.06] min-w-0">
              <RingProgress
                percent={Math.min(100, (gastoHoje ?? 0) / metaDiaria! * 100)}
                size={96}
                stroke={8}
                color={corPorPercent(pctMeta)}
                label={`${displayPctMeta}%`}
                sublabel="meta diária"
              />
              <div className="text-center min-w-0">
                <p className="text-[10px] text-zinc-500 num-tabular whitespace-nowrap">
                  {formatBRL(gastoHoje ?? 0)} / {formatBRL(metaDiaria!)}
                </p>
                <p className="text-[10px] text-zinc-600 mt-0.5">
                  {labelPorPercent(pctMeta)}
                </p>
              </div>
            </div>

            {/* Mobile: linha abaixo do saldo, mais simples */}
            <div className="md:hidden flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <RingProgress
                percent={Math.min(100, (gastoHoje ?? 0) / metaDiaria! * 100)}
                size={56}
                stroke={6}
                color={corPorPercent(pctMeta)}
                label={`${displayPctMeta}%`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-zinc-300 font-medium">
                  Meta diária: {formatBRL(metaDiaria!)}
                </p>
                <p className="text-[11px] text-zinc-500 num-tabular">
                  {formatBRL(gastoHoje ?? 0)} gastos hoje · {labelPorPercent(pctMeta)}
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
