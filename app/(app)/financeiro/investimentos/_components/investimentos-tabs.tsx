'use client';

/**
 * InvestimentosTabs — gerenciador de abas da página /financeiro/investimentos.
 *
 * URL é a source-of-truth da aba ativa (`?tab=renda-passiva` ou
 * ausente = "reserva" como default). Renderiza ambas as abas
 * simultaneamente, escondendo a inativa via `hidden` — preserva o
 * useState local de cada aba (em particular o localStorage da
 * renda-passiva).
 */

import { Suspense, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShieldCheck, TrendingUp } from 'lucide-react';
import { AbaReservaEmergencia } from './aba-reserva-emergencia';
import { AbaRendaPassiva } from './aba-renda-passiva';

type Tab = 'reserva' | 'renda-passiva';

function lerTab(searchParams: URLSearchParams | undefined): Tab {
  if (!searchParams) return 'reserva';
  const tab = searchParams.get('tab');
  if (tab === 'renda-passiva') return 'renda-passiva';
  return 'reserva';
}

interface Props {
  searchParams?: Promise<{ tab?: string }>;
}

export function InvestimentosTabs({ searchParams }: Props) {
  // Em Next 15, searchParams é uma Promise. Resolve com `use()`
  // ou Suspense + useSearchParams no fallback.
  const sp = searchParams ? use(searchParams).tab : undefined;
  const router = useRouter();

  const tab: Tab = sp === 'renda-passiva' ? 'renda-passiva' : 'reserva';

  function trocar(proxima: Tab) {
    const url =
      proxima === 'reserva'
        ? '/financeiro/investimentos'
        : '/financeiro/investimentos?tab=renda-passiva';
    router.push(url, { scroll: false });
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto whitespace-nowrap">
        <TabButton
          ativa={tab === 'reserva'}
          onClick={() => trocar('reserva')}
          icon={ShieldCheck}
          label="Reserva de Emergência"
        />
        <TabButton
          ativa={tab === 'renda-passiva'}
          onClick={() => trocar('renda-passiva')}
          icon={TrendingUp}
          label="Renda Passiva"
        />
      </div>

      {/* Conteúdo — ambas as abas montadas, inativa fica hidden */}
      <div className={tab === 'reserva' ? '' : 'hidden'}>
        <AbaReservaEmergencia />
      </div>
      <div className={tab === 'renda-passiva' ? '' : 'hidden'}>
        <AbaRendaPassiva />
      </div>
    </div>
  );
}

function TabButton({
  ativa,
  onClick,
  icon: Icon,
  label,
}: {
  ativa: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={ativa ? 'page' : undefined}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0 ${
        ativa
          ? 'glass-elevated border border-emerald-500/30 bg-emerald-500/[0.04] text-emerald-200'
          : 'glass border border-white/[0.06] text-zinc-400 hover:text-zinc-200 hover:border-white/[0.12]'
      }`}
    >
      <Icon className={`w-4 h-4 ${ativa ? 'text-emerald-300' : ''}`} />
      {label}
    </button>
  );
}

// Re-export pra server component poder embrulhar com Suspense
export function InvestimentosTabsSuspense(props: Props) {
  return (
    <Suspense fallback={<div className="h-32 rounded-xl shimmer" />}>
      <InvestimentosTabs {...props} />
    </Suspense>
  );
}
