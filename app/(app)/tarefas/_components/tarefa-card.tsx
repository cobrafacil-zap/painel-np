'use client';

import { CheckCircle2, Pencil, X, AlertTriangle, Calendar, Clock, Repeat, GripVertical, Check } from 'lucide-react';
import { formatDateBR, cn } from '@/lib/utils';
import type { Tarefa } from '@/lib/types';

const DIAS_PT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function diaSemanaCurto(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return DIAS_PT[new Date(y, m - 1, d).getDay()];
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

const PRIORIDADE_COR: Record<string, { texto: string; borda: string; bg: string }> = {
  alta: { texto: 'text-red-300', borda: 'border-red-500/30', bg: 'bg-red-500/10' },
  media: { texto: 'text-amber-300', borda: 'border-amber-500/30', bg: 'bg-amber-500/10' },
  baixa: { texto: 'text-zinc-400', borda: 'border-zinc-500/30', bg: 'bg-white/[0.04]' },
};

export function TarefaCard({
  t,
  onConcluir,
  onEdit,
  onDelete,
}: {
  t: Tarefa;
  onConcluir: (id: string) => void;
  onEdit: (t: Tarefa) => void;
  onDelete: (id: string) => void;
}) {
  const dias = diasAte(t.data_prazo);
  const atrasada = t.status === 'pendente' && dias < 0;
  const hoje = t.status === 'pendente' && dias === 0;
  const concluida = t.status === 'concluida';
  const cancelada = t.status === 'cancelada';

  const corPrio = PRIORIDADE_COR[t.prioridade] ?? PRIORIDADE_COR.media;

  return (
    <div
      className={cn(
        'group glass card-hover-lift p-4 sm:p-5',
        concluida || cancelada ? 'opacity-60' : '',
        atrasada && 'pulse-border-l',
        !atrasada && (hoje ? 'border-amber-500/30' : '')
      )}
    >
      <div className="flex items-start gap-3">
        {/* Drag handle (apenas hover, em telas grandes) */}
        <GripVertical className="hidden sm:block w-4 h-4 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing mt-1 shrink-0" />

        {/* Concluir (círculo grande) */}
        {t.status === 'pendente' && (
          <button
            onClick={() => onConcluir(t.id)}
            className={cn(
              'shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all mt-0.5',
              'border-zinc-600 hover:border-emerald-400 hover:bg-emerald-400/10',
              'hover:scale-110 active:scale-95'
            )}
            title="Marcar como concluída"
            aria-label="Concluir"
          >
            <Check className="w-3.5 h-3.5 text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        )}
        {concluida && (
          <div className="shrink-0 w-7 h-7 rounded-full border-2 border-emerald-500 bg-emerald-500/15 flex items-center justify-center mt-0.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
        )}
        {cancelada && (
          <div className="shrink-0 w-7 h-7 rounded-full border-2 border-zinc-600 bg-white/[0.02] flex items-center justify-center mt-0.5">
            <X className="w-3.5 h-3.5 text-zinc-500" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="text-base shrink-0">{t.tipo === 'compromisso' ? '📅' : '⏳'}</span>
            <h3 className={cn('font-medium truncate min-w-0', concluida && 'line-through text-zinc-500')}>
              {t.titulo}
            </h3>
            <span
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wider',
                corPrio.texto,
                corPrio.borda,
                corPrio.bg
              )}
              title={`Prioridade ${t.prioridade}`}
            >
              {t.prioridade}
            </span>
            {t.recorrencia && (
              <span className="text-[10px] text-zinc-500 inline-flex items-center gap-1">
                <Repeat className="w-3 h-3" />
                {t.recorrencia}
              </span>
            )}
            {concluida && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" /> concluída
              </span>
            )}
            {cancelada && (
              <span className="inline-flex items-center gap-1 text-xs text-zinc-500">cancelada</span>
            )}
          </div>

          {t.descricao && (
            <p className="text-sm text-zinc-400 mt-1">{t.descricao}</p>
          )}

          <div className="flex items-center gap-3 mt-2 text-xs text-zinc-500 flex-wrap">
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {diaSemanaCurto(t.data_prazo)} {formatDateBR(t.data_prazo)}
              {atrasada && (
                <span className="text-red-300 ml-1 inline-flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {Math.abs(dias)}d atrasada
                </span>
              )}
              {hoje && <span className="text-amber-300 ml-1">HOJE</span>}
            </span>
            {t.hora_prazo && (
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {horaCurta(t.hora_prazo)}
              </span>
            )}
            {t.categoria && <span className="text-zinc-400">• {t.categoria}</span>}
          </div>
        </div>

        <div className="flex gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
          {t.status === 'pendente' && (
            <button
              onClick={() => onConcluir(t.id)}
              className="hidden sm:inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 transition-colors"
              title="Marcar como concluída"
            >
              <Check className="w-3 h-3" />
              Concluir
            </button>
          )}
          <button
            onClick={() => onEdit(t)}
            className="p-1.5 rounded-md hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-100 transition-colors"
            title="Editar"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(t.id)}
            className="p-1.5 rounded-md hover:bg-red-500/10 text-zinc-500 hover:text-red-300 transition-colors"
            title="Apagar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
