'use client';

import { CheckCircle2, Pencil, X, AlertTriangle, Calendar, Clock, Repeat } from 'lucide-react';
import { formatDateBR } from '@/lib/utils';
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

const PRIORIDADE_COR: Record<string, string> = {
  alta: 'text-red-300 border-red-500/30',
  media: 'text-amber-300 border-amber-500/30',
  baixa: 'text-zinc-400 border-zinc-500/30',
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
      className={`card ${
        concluida || cancelada ? 'opacity-60' : ''
      } ${atrasada ? 'border-red-500/40' : hoje ? 'border-amber-500/40' : ''}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg">{t.tipo === 'compromisso' ? '📅' : '⏳'}</span>
            <h3
              className={`font-medium truncate ${
                concluida ? 'line-through' : ''
              }`}
            >
              {t.titulo}
            </h3>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded border ${corPrio}`}
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
              <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                cancelada
              </span>
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
            {t.categoria && (
              <span className="text-zinc-400">• {t.categoria}</span>
            )}
          </div>
        </div>

        <div className="flex gap-1 shrink-0">
          {t.status === 'pendente' && (
            <button
              onClick={() => onConcluir(t.id)}
              className="text-xs px-2.5 py-1 rounded bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
              title="Marcar como concluída"
            >
              ✓ Concluir
            </button>
          )}
          <button
            onClick={() => onEdit(t)}
            className="p-1.5 rounded hover:bg-bg-elevated text-zinc-400 hover:text-zinc-200"
            title="Editar"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(t.id)}
            className="p-1.5 rounded hover:bg-red-500/10 text-zinc-500 hover:text-red-300"
            title="Apagar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
