'use client';

import { useEffect, useState } from 'react';
import { Plus, ListTodo } from 'lucide-react';
import { TarefaCard } from './_components/tarefa-card';
import { TarefaForm } from './_components/tarefa-form';
import { RingProgress } from '@/lib/svg/ring-progress';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { PageHeader } from '../_components/page-header';
import type { Tarefa } from '@/lib/types';

type Filtro = 'pendente' | 'concluida' | 'cancelada' | 'todas';

export default function TarefasPage() {
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Tarefa | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('pendente');

  useEffect(() => {
    setLoading(true);
    fetch('/api/tarefas')
      .then((r) => r.json())
      .then(({ tarefas }) => {
        setTarefas((tarefas ?? []) as Tarefa[]);
        setLoading(false);
      });
  }, [refreshKey]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function concluir(id: string) {
    const res = await fetch(`/api/tarefas/${id}/concluir`, { method: 'POST' });
    if (res.ok) {
      flash('✅ Tarefa concluída.');
      setRefreshKey((k) => k + 1);
    } else flash('⚠️ Erro ao marcar como concluída.');
  }

  async function deletar(id: string) {
    if (!confirm('Apagar esta tarefa?')) return;
    const res = await fetch(`/api/tarefas/${id}`, { method: 'DELETE' });
    if (res.ok) {
      flash('🗑️ Tarefa apagada.');
      setRefreshKey((k) => k + 1);
    } else flash('⚠️ Erro ao apagar.');
  }

  const filtradas = tarefas.filter((t) =>
    filtro === 'todas' ? true : t.status === filtro
  );

  // Resumo
  const hoje = new Date().toISOString().slice(0, 10);
  const amanhaISO = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  const totalPendentes = tarefas.filter((t) => t.status === 'pendente').length;
  const totalAtrasadas = tarefas.filter(
    (t) => t.status === 'pendente' && t.data_prazo < hoje
  ).length;
  const totalProximas24h = tarefas.filter(
    (t) =>
      t.status === 'pendente' &&
      (t.data_prazo === hoje || t.data_prazo === amanhaISO)
  ).length;

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Módulo"
        title="Tarefas"
        subtitle={
          <>
            Compromissos e prazos. Manda no WhatsApp tipo{' '}
            <span className="text-zinc-400">
              &ldquo;tenho reunião sexta às 14h&rdquo;
            </span>
            .
          </>
        }
        action={
          <Button
            variant="primary"
            size="md"
            onClick={() => setShowNew(true)}
            className="rounded-full px-4 sm:px-5 shadow-[0_0_24px_-6px_rgb(34,197,94,0.5)]"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Nova tarefa</span>
            <span className="sm:hidden">Nova</span>
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <SummaryCard label="Pendentes" value={totalPendentes} color="zinc" />
        <SummaryCard
          label="Atrasadas"
          value={totalAtrasadas}
          color={totalAtrasadas > 0 ? 'red' : 'zinc'}
        />
        <SummaryCard
          label="Próx. 24h"
          value={totalProximas24h}
          color={totalProximas24h > 0 ? 'amber' : 'zinc'}
        />
      </div>

      <div className="flex gap-2 flex-wrap">
        {(
          [
            { v: 'pendente', l: 'Pendentes' },
            { v: 'concluida', l: 'Concluídas' },
            { v: 'cancelada', l: 'Canceladas' },
            { v: 'todas', l: 'Todas' },
          ] as { v: Filtro; l: string }[]
        ).map((f) => (
          <button
            key={f.v}
            onClick={() => setFiltro(f.v)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all ${
              filtro === f.v
                ? 'bg-accent-400/15 border-accent-400/40 text-accent-300 shadow-[0_0_18px_-4px_rgb(34,197,94,0.5)]'
                : 'bg-white/[0.02] border-white/[0.06] text-zinc-400 hover:text-zinc-200 hover:border-white/15'
            }`}
          >
            {f.l}
          </button>
        ))}
      </div>

      <div className="space-y-3 relative min-h-[200px]">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass p-5 h-24 shimmer rounded-xl" />
            ))}
          </div>
        ) : filtradas.length === 0 ? (
          <EmptyState
            icon={<ListTodo className="w-10 h-10" />}
            title={
              filtro === 'pendente'
                ? 'Nenhuma tarefa pendente'
                : `Nenhuma tarefa ${
                    filtro === 'todas'
                      ? 'cadastrada'
                      : filtro === 'concluida'
                        ? 'concluída'
                        : 'cancelada'
                  }`
            }
            description={
              filtro === 'pendente'
                ? 'Manda no WhatsApp ou clica em "Nova tarefa".'
                : 'Quando você mudar o status, ela aparece aqui.'
            }
          />
        ) : (
          filtradas.map((t) => (
            <TarefaCard
              key={t.id}
              t={t}
              onConcluir={concluir}
              onEdit={() => setEditing(t)}
              onDelete={deletar}
            />
          ))
        )}

        {toast && (
          <div className="fixed bottom-6 right-6 z-50 glass-elevated px-4 py-2.5 text-sm shadow-xl fade-in-up">
            {toast}
          </div>
        )}
      </div>

      {showNew && (
        <TarefaForm
          onClose={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false);
            flash('✅ Tarefa criada.');
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      {editing && (
        <TarefaForm
          tarefa={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            flash('✅ Atualizado.');
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color = 'zinc',
}: {
  label: string;
  value: number;
  color?: 'zinc' | 'red' | 'amber';
}) {
  const total = Math.max(value, 1);
  const cor =
    color === 'red' ? '#ef4444' : color === 'amber' ? '#f59e0b' : '#22c55e';
  const ringColor = color === 'red' ? '#ef4444' : color === 'amber' ? '#f59e0b' : '#22c55e';

  return (
    <div className="glass p-4 flex items-center gap-3 sm:gap-4">
      <RingProgress
        percent={Math.min(100, (value / total) * 100)}
        size={48}
        stroke={6}
        color={ringColor}
      />
      <div className="min-w-0">
        <p className="label-eyebrow">{label}</p>
        <p
          className={`text-2xl font-bold num-tabular mt-1 ${
            color === 'red'
              ? 'text-red-300'
              : color === 'amber'
                ? 'text-amber-300'
                : 'text-zinc-100'
          }`}
        >
          {value}
        </p>
      </div>
    </div>
  );
}
