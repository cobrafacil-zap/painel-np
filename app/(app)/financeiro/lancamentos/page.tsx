'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { FinanceRecord } from '@/lib/types';
import { LancamentoForm } from '../_components/lancamento-form';
import { formatBRL, formatDateBR } from '@/lib/utils';
import { Trash2 } from 'lucide-react';

export default function LancamentosPage() {
  const [records, setRecords] = useState<FinanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<FinanceRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    createClient()
      .from('records')
      .select('*')
      .eq('module_id', 'financeiro')
      .order('occurred_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(500)
      .then(({ data }) => {
        setRecords((data ?? []) as FinanceRecord[]);
        setLoading(false);
      });
  }, [refreshKey]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    const res = await fetch(`/api/financeiro/lancamentos/${pendingDelete.id}`, { method: 'DELETE' });
    setDeleting(false);
    if (res.ok) {
      const r = pendingDelete;
      flash(`🗑️ Lançamento de ${formatBRL(Number(r.amount))} apagado.`);
      setPendingDelete(null);
      setRefreshKey((k) => k + 1);
    } else {
      flash('⚠️ Erro ao apagar.');
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Lançamentos</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Todos os seus gastos e receitas. Use o WhatsApp pra adicionar rápido, ou o botão abaixo.
          </p>
        </div>
        <LancamentoForm onCreated={() => setRefreshKey((k) => k + 1)} />
      </header>

      <div className="card overflow-hidden p-0 relative">
        {loading ? (
          <p className="p-6 text-sm text-zinc-500">Carregando…</p>
        ) : records.length === 0 ? (
          <p className="p-6 text-sm text-zinc-500">Nenhum lançamento ainda. Use o botão acima ou mande no WhatsApp.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-bg-elevated text-zinc-400">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Data</th>
                <th className="text-left px-4 py-2.5 font-medium">Descrição</th>
                <th className="text-left px-4 py-2.5 font-medium">Categoria</th>
                <th className="text-left px-4 py-2.5 font-medium">Forma</th>
                <th className="text-right px-4 py-2.5 font-medium">Valor</th>
                <th className="text-right px-4 py-2.5 font-medium">Origem</th>
                <th className="w-12"></th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-bg-elevated/50">
                  <td className="px-4 py-2.5 text-zinc-400 whitespace-nowrap">{formatDateBR(r.occurred_at)}</td>
                  <td className="px-4 py-2.5">{r.description ?? '—'}</td>
                  <td className="px-4 py-2.5 text-zinc-400">{r.category ?? '—'}</td>
                  <td className="px-4 py-2.5 text-zinc-400">{r.payment_method ?? '—'}</td>
                  <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${r.type === 'receita' ? 'text-emerald-300' : 'text-red-300'}`}>
                    {r.type === 'receita' ? '+' : '−'} {formatBRL(Number(r.amount))}
                  </td>
                  <td className="px-4 py-2.5 text-right text-zinc-500 text-xs">
                    {r.source === 'whatsapp' ? '📱 WhatsApp' : r.source}
                  </td>
                  <td className="px-2">
                    <button
                      onClick={() => setPendingDelete(r)}
                      className="p-1.5 rounded hover:bg-red-500/10 text-zinc-500 hover:text-red-300 transition-colors"
                      title="Apagar lançamento"
                      aria-label="Apagar lançamento"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Toast de feedback */}
        {toast && (
          <div className="absolute bottom-4 right-4 bg-bg-elevated border border-border rounded-lg px-4 py-2.5 text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2">
            {toast}
          </div>
        )}
      </div>

      {/* Modal de confirmação */}
      {pendingDelete && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => !deleting && setPendingDelete(null)}
        >
          <div
            className="card max-w-sm w-full space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">Apagar lançamento?</h3>
            <div className="text-sm text-zinc-400 space-y-1">
              <p>
                <span className={pendingDelete.type === 'receita' ? 'text-emerald-300' : 'text-red-300'}>
                  {pendingDelete.type === 'receita' ? '+' : '−'}
                  {formatBRL(Number(pendingDelete.amount))}
                </span>
                {' '}— {pendingDelete.description ?? pendingDelete.category ?? 'sem descrição'}
              </p>
              <p className="text-xs">Data: {formatDateBR(pendingDelete.occurred_at)}</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-sm hover:bg-bg-elevated transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-sm bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors disabled:opacity-50"
              >
                {deleting ? 'Apagando…' : 'Apagar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
