'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { TarefaCard } from './_components/tarefa-card';
import { TarefaForm } from './_components/tarefa-form';
import type { Tarefa } from '@/lib/types';

export default function TarefasPage() {
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Tarefa | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<'pendente' | 'concluida' | 'cancelada' | 'todas'>(
    'pendente'
  );

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
  const amanha = new Date();
  amanha.setDate(amanha.getDate() + 1);
  const amanhaISO = amanha.toISOString().slice(0, 10);

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
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Tarefas</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Compromissos e prazos. Manda no WhatsApp tipo
            &ldquo;tenho reunião sexta às 14h&rdquo;.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Nova tarefa
        </button>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard label="📋 Pendentes" value={String(totalPendentes)} />
        <SummaryCard
          label="🔴 Atrasadas"
          value={String(totalAtrasadas)}
          color={totalAtrasadas > 0 ? 'red' : 'zinc'}
        />
        <SummaryCard
          label="⏰ Próximas 24h"
          value={String(totalProximas24h)}
          color={totalProximas24h > 0 ? 'amber' : 'zinc'}
        />
      </div>

      <div className="flex gap-2">
        {(['pendente', 'concluida', 'cancelada', 'todas'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`px-3 py-1.5 rounded-lg text-xs capitalize ${
              filtro === f
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-bg-elevated text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {f === 'todas' ? 'todas' : f === 'pendente' ? 'pendentes' : f === 'concluida' ? 'concluídas' : 'canceladas'}
          </button>
        ))}
      </div>

      <div className="space-y-3 relative">
        {loading ? (
          <p className="text-sm text-zinc-500">Carregando…</p>
        ) : filtradas.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-zinc-400">
              {filtro === 'pendente'
                ? 'Nenhuma tarefa pendente. Manda uma no WhatsApp!'
                : `Nenhuma tarefa ${filtro === 'todas' ? '' : filtro}.`}
            </p>
          </div>
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
          <div className="fixed bottom-6 right-6 bg-bg-elevated border border-border rounded-lg px-4 py-2.5 text-sm shadow-lg z-50">
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
  value: string;
  color?: 'zinc' | 'red' | 'amber';
}) {
  const cor =
    color === 'red'
      ? 'text-red-300'
      : color === 'amber'
        ? 'text-amber-300'
        : 'text-zinc-200';
  return (
    <div className="card">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums mt-1 ${cor}`}>{value}</p>
    </div>
  );
}
