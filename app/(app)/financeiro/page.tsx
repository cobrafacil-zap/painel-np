'use client';

import { useState } from 'react';
import { LancamentoForm } from './_components/lancamento-form';
import { ResumoCharts } from './_components/resumo-charts';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function FinanceiroPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Financeiro</h1>
          <p className="text-sm text-zinc-500 mt-1">Visão geral do mês corrente.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/financeiro/lancamentos" className="btn-ghost inline-flex items-center gap-1.5">
            Ver todos <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <LancamentoForm onCreated={() => setRefreshKey((k) => k + 1)} />
        </div>
      </header>

      <ResumoCharts refreshKey={refreshKey} />
    </div>
  );
}
