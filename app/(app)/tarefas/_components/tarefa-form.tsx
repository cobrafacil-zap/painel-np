'use client';

import { useState } from 'react';
import type { Tarefa } from '@/lib/types';

export function TarefaForm({
  tarefa,
  onClose,
  onSaved,
}: {
  tarefa?: Tarefa;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [titulo, setTitulo] = useState(tarefa?.titulo ?? '');
  const [descricao, setDescricao] = useState(tarefa?.descricao ?? '');
  const [dataPrazo, setDataPrazo] = useState(tarefa?.data_prazo ?? '');
  const [horaPrazo, setHoraPrazo] = useState(
    tarefa?.hora_prazo ? tarefa.hora_prazo.slice(0, 5) : ''
  );
  const [categoria, setCategoria] = useState(tarefa?.categoria ?? '');
  const [prioridade, setPrioridade] = useState(tarefa?.prioridade ?? 'media');
  const [recorrencia, setRecorrencia] = useState(tarefa?.recorrencia ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!titulo.trim() || !dataPrazo) return;
    setSaving(true);
    const payload = {
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      data_prazo: dataPrazo,
      hora_prazo: horaPrazo ? `${horaPrazo}:00` : null,
      categoria: categoria.trim() || null,
      prioridade,
      recorrencia: recorrencia || null,
    };
    const url = tarefa ? `/api/tarefas/${tarefa.id}` : '/api/tarefas';
    const method = tarefa ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (res.ok) onSaved();
    else {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? 'Erro ao salvar');
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="card max-w-md w-full space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold">
          {tarefa ? 'Editar tarefa' : 'Nova tarefa'}
        </h3>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Título</label>
          <input
            type="text"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex: Reunião com cliente"
            className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Descrição (opcional)</label>
          <input
            type="text"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Data</label>
            <input
              type="date"
              value={dataPrazo}
              onChange={(e) => setDataPrazo(e.target.value)}
              className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Hora (opcional)</label>
            <input
              type="time"
              value={horaPrazo}
              onChange={(e) => setHoraPrazo(e.target.value)}
              className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Categoria</label>
            <input
              type="text"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              placeholder="trabalho"
              className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Prioridade</label>
            <select
              value={prioridade}
              onChange={(e) => setPrioridade(e.target.value as 'baixa' | 'media' | 'alta')}
              className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm"
            >
              <option value="baixa">baixa</option>
              <option value="media">média</option>
              <option value="alta">alta</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Recorrência</label>
          <select
            value={recorrencia}
            onChange={(e) => setRecorrencia(e.target.value)}
            className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm"
          >
            <option value="">única</option>
            <option value="semanal">semanal</option>
            <option value="mensal">mensal</option>
          </select>
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm hover:bg-bg-elevated"
          >
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving || !titulo.trim() || !dataPrazo}
            className="px-4 py-2 rounded-lg text-sm bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : tarefa ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  );
}
