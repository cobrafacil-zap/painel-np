'use client';

import { useCountUp } from '@/lib/hooks/use-count-up';
import { RingProgress } from '@/lib/svg/ring-progress';
import { formatBRL } from '@/lib/utils';

export function HeroSaldo({
  receitas,
  gastos,
  saldo,
}: {
  receitas: number;
  gastos: number;
  saldo: number;
}) {
  // % do orçamento "imaginário": quanto do total movimentado foi gasto.
  // Se não houve movimentação, ring fica em 0.
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

  return (
    <div className="glass-elevated p-6 sm:p-8 relative overflow-hidden">
      {/* Glow verde no canto */}
      <div
        aria-hidden
        className="absolute -top-20 -right-20 w-72 h-72 rounded-full opacity-30 blur-3xl pointer-events-none"
        style={{
          background:
            'radial-gradient(circle, rgb(34 197 94 / 0.4) 0%, transparent 60%)',
        }}
      />

      <div className="relative grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6 md:gap-10 items-center">
        {/* Ring SVG */}
        <div className="flex justify-center md:justify-start">
          <RingProgress
            percent={percentGastos}
            size={200}
            stroke={14}
            color="#22c55e"
            label={`${percentGastos.toFixed(0)}%`}
            sublabel="gasto"
          />
        </div>

        {/* Saldo + breakdown */}
        <div className="min-w-0">
          <p className="label-eyebrow">Saldo do mês</p>
          <p
            className={`text-5xl sm:text-6xl font-extrabold tracking-tight num-tabular mt-2 ${saldoColor}`}
          >
            {formatBRL(displaySaldo)}
          </p>

          <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-zinc-400">Receitas</span>
              <span className="text-emerald-300 font-semibold num-tabular">
                +{formatBRL(displayReceitas)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-400" />
              <span className="text-zinc-400">Gastos</span>
              <span className="text-red-300 font-semibold num-tabular">
                −{formatBRL(displayGastos)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
