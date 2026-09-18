'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Check, Calendar, Clock, AlertTriangle, Repeat, GripVertical } from 'lucide-react';
import { useDraggable } from '@/lib/hooks/use-draggable';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import type { Tarefa } from '@/lib/types';

function diaSemanaCurto(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(y, m - 1, d).getDay()];
}

function diasAte(iso: string): number {
  const alvo = new Date(iso + 'T00:00:00');
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((alvo.getTime() - hoje.getTime()) / 86400000);
}

function horaCurta(hms: string | null): string {
  return hms ? hms.slice(0, 5) : '';
}

function rotuloData(dias: number): { texto: string; classe: string } {
  if (dias < 0) return { texto: `${Math.abs(dias)}d atrasada`, classe: 'text-red-300' };
  if (dias === 0) return { texto: 'Hoje', classe: 'text-amber-300' };
  if (dias === 1) return { texto: 'Amanhã', classe: 'text-amber-300' };
  if (dias <= 7) return { texto: `Em ${dias}d`, classe: 'text-zinc-300' };
  return { texto: `Em ${dias}d`, classe: 'text-zinc-400' };
}

export function TarefasProximas({ tarefas }: { tarefas: Tarefa[] }) {
  const router = useRouter();
  const [items, setItems] = useState(tarefas);
  const [pending, setPending] = useState<string | null>(null);

  // Mantém items em sync se o servidor enviar outras (após refresh)
  if (items !== tarefas && items.length === tarefas.length && items[0]?.id === tarefas[0]?.id) {
    // nada, OK
  }

  const drag = useDraggable({
    items,
    onReorder: async (newItems) => {
      setItems(newItems);
      // Persiste ordem no servidor
      try {
        await fetch('/api/tarefas/ordem', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ordem: newItems.map((t, i) => ({ id: t.id, ordem: i })),
          }),
        });
      } catch {
        // silencioso — usuário pode arrastar de novo
      }
    },
  });

  async function concluir(id: string) {
    setPending(id);
    try {
      const res = await fetch(`/api/tarefas/${id}/concluir`, { method: 'POST' });
      if (res.ok) {
        // Remove da lista local com fade-out
        setItems((cur) => cur.filter((t) => t.id !== id));
        router.refresh();
      }
    } finally {
      setPending(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className="glass p-5">
        <header className="flex items-center justify-between mb-4">
          <h2 className="font-semibold flex items-center gap-2">
            <span className="text-lg">📋</span>
            Próximas tarefas
          </h2>
          <Link
            href="/tarefas"
            className="text-xs text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1"
          >
            Ver todas <ArrowRight className="w-3 h-3" />
          </Link>
        </header>
        <EmptyState
          title="Tudo em dia 🎉"
          description="Sem tarefas pendentes. Manda uma no WhatsApp que aparece aqui."
        />
      </div>
    );
  }

  return (
    <div className="glass p-5">
      <header className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2">
          <span className="text-lg">📋</span>
          Próximas tarefas
        </h2>
        <Link
          href="/tarefas"
          className="text-xs text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1 group"
        >
          Ver todas
          <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </header>

      <ul className="space-y-1.5">
        {items.map((t, i) => {
          const dias = diasAte(t.data_prazo);
          const atrasada = dias < 0;
          const rotulo = rotuloData(dias);

          return (
            <li
              key={t.id}
              {...drag.itemProps(i)}
              className={cn(
                'group flex items-center gap-3 px-2.5 py-2.5 rounded-lg border border-transparent hover:border-white/[0.06] hover:bg-white/[0.025] transition-all',
                atrasada && 'pulse-border-l'
              )}
            >
              {/* Drag handle (visível no hover) */}
              <GripVertical className="w-3.5 h-3.5 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing shrink-0" />

              {/* Concluir */}
              <button
                onClick={() => concluir(t.id)}
                disabled={pending === t.id}
                className={cn(
                  'shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all',
                  'border-zinc-600 hover:border-emerald-400 hover:bg-emerald-400/10',
                  'disabled:opacity-50 disabled:cursor-wait'
                )}
                title="Marcar como concluída"
                aria-label="Concluir"
              >
                <Check className="w-3 h-3 text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>

              {/* Conteúdo */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm shrink-0">{t.tipo === 'compromisso' ? '📅' : '⏳'}</span>
                  <span className="text-sm font-medium truncate text-zinc-100">{t.titulo}</span>
                  {t.recorrencia && (
                    <Repeat className="w-3 h-3 text-zinc-500 shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-zinc-500 mt-0.5 num-tabular">
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {diaSemanaCurto(t.data_prazo)} {t.data_prazo.slice(8, 10)}/
                    {t.data_prazo.slice(5, 7)}
                  </span>
                  {t.hora_prazo && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {horaCurta(t.hora_prazo)}
                    </span>
                  )}
                  {t.categoria && <span>• {t.categoria}</span>}
                </div>
              </div>

              {/* Badge de data relativa */}
              <div
                className={cn(
                  'shrink-0 text-[11px] font-medium num-tabular px-2 py-0.5 rounded-full',
                  atrasada
                    ? 'bg-red-500/10 text-red-300 border border-red-500/30'
                    : dias <= 1
                      ? 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
                      : 'bg-white/[0.04] text-zinc-400 border border-white/[0.06]'
                )}
              >
                {atrasada && <AlertTriangle className="w-3 h-3 inline mr-1" />}
                {rotulo.texto}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
