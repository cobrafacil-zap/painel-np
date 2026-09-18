'use client';

import Link from 'next/link';
import { Wallet, ListTodo, MessageCircle, Dumbbell, ArrowRight } from 'lucide-react';

export function AtalhosRapidos({ whatsappOn }: { whatsappOn: boolean }) {
  const itens = [
    {
      href: '/financeiro',
      icon: Wallet,
      titulo: 'Financeiro',
      subtitulo: 'Lançamentos, gráficos, compromissos',
      accent: 'emerald',
    },
    {
      href: '/tarefas',
      icon: ListTodo,
      titulo: 'Tarefas',
      subtitulo: 'Compromissos e prazos do mês',
      accent: 'amber',
    },
    {
      href: '/painel/whatsapp',
      icon: MessageCircle,
      titulo: 'WhatsApp',
      subtitulo: whatsappOn ? 'Conectado' : 'Configurar instância',
      accent: whatsappOn ? 'emerald' : 'zinc',
    },
  ];

  const accentClass: Record<string, string> = {
    emerald: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
    amber: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
    zinc: 'text-zinc-300 bg-white/[0.04] border-white/[0.06]',
  };

  return (
    <div className="glass p-5 h-full flex flex-col">
      <header className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">Atalhos</h2>
      </header>

      <div className="space-y-2 flex-1">
        {itens.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group flex items-center gap-3 p-3 rounded-lg border border-white/[0.04] hover:border-white/[0.12] hover:bg-white/[0.03] transition-all"
            >
              <div
                className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center border ${accentClass[item.accent]}`}
              >
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-100 leading-tight">
                  {item.titulo}
                </p>
                <p className="text-[11px] text-zinc-500 truncate">
                  {item.subtitulo}
                </p>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-300 group-hover:translate-x-0.5 transition-all" />
            </Link>
          );
        })}

        {/* Placeholder Treino */}
        <div className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-white/[0.06] opacity-60">
          <div className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-white/[0.02] border border-white/[0.04]">
            <Dumbbell className="w-4 h-4 text-zinc-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-zinc-400 leading-tight">
              Treino
            </p>
            <p className="text-[11px] text-zinc-600">Em breve</p>
          </div>
        </div>
      </div>
    </div>
  );
}
