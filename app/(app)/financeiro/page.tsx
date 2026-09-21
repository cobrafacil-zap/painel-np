'use client';

import { useState } from 'react';
import { LancamentoForm } from './_components/lancamento-form';
import { ResumoCharts } from './_components/resumo-charts';
import { ArrowRight, ListChecks, ScrollText, Tags, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { PageHeader } from '../_components/page-header';

export default function FinanceiroPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  const atalhos = [
    {
      href: '/financeiro/investimentos',
      icon: TrendingUp,
      titulo: 'Investimentos',
      subtitulo: 'Reserva de emergência + renda passiva',
    },
    {
      href: '/financeiro/lancamentos',
      icon: ListChecks,
      titulo: 'Lançamentos',
      subtitulo: 'Lista completa de gastos e receitas',
    },
    {
      href: '/financeiro/compromissos',
      icon: ScrollText,
      titulo: 'Compromissos',
      subtitulo: 'Contas fixas, parceladas e pendentes',
    },
    {
      href: '/financeiro/categorias',
      icon: Tags,
      titulo: 'Categorias',
      subtitulo: 'Cores e organização',
    },
  ];

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Módulo"
        title="Financeiro"
        subtitle="Visão geral do mês corrente."
        action={
          <div className="flex gap-2 flex-wrap">
            <Link
              href="/financeiro/lancamentos"
              className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 rounded-md hover:bg-bg-elevated text-zinc-300 hover:text-zinc-100 text-sm font-medium transition-colors"
            >
              Ver todos <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <LancamentoForm onCreated={() => setRefreshKey((k) => k + 1)} />
          </div>
        }
      />

      {/* Atalhos pros sub-páginas (incluindo renda-passiva como destaque) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        {atalhos.map((a) => {
          const Icon = a.icon;
          const destaque = a.href === '/financeiro/investimentos';
          return (
            <Link
              key={a.href}
              href={a.href}
              className={`group p-4 flex items-center gap-3 transition-all border ${
                destaque
                  ? 'glass-elevated border-emerald-500/30 hover:border-emerald-500/50 bg-emerald-500/[0.04]'
                  : 'glass hover:border-white/[0.12] hover:bg-white/[0.04]'
              }`}
            >
              <div
                className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${
                  destaque
                    ? 'bg-emerald-500/20 border border-emerald-500/30'
                    : 'bg-emerald-500/10 border border-emerald-500/20'
                }`}
              >
                <Icon className="w-4 h-4 text-emerald-300" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-100 leading-tight">
                  {a.titulo}
                </p>
                <p className="text-[11px] text-zinc-500 truncate">{a.subtitulo}</p>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-300 group-hover:translate-x-0.5 transition-all" />
            </Link>
          );
        })}
      </div>

      <ResumoCharts refreshKey={refreshKey} />
    </div>
  );
}
