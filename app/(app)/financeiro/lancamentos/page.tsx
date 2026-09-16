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

  async function handleDelete(id: string) {
    if (!confirm('Apagar este lançamento?')) return;
    const res = await fetch(`/api/financeiro/lancamentos/${id}`, { method: 'DELETE' });
    if (res.ok) setRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Lançamentos</h1>
          <p className="text-sm text-zinc-500 mt-1">Todos os seus gastos e receitas.</p>
        </div>
        <LancamentoForm onCreated={() => setRefreshKey((k) => k + 1)} />
      </header>

      <div className="card overflow-hidden p-0">
        {loading ? (
          <p className="p-6 text-sm text-zinc-500">Carregando…</p>
        ) : records.length === 0 ? (
          <p className="p-6 text-sm text-zinc-500">Nenhum lançamento ainda. Use o botão acima para começar.</p>
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
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-bg-elevated/50">
                  <td className="px-4 py-2.5 text-zinc-400">{formatDateBR(r.occurred_at)}</td>
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
                      onClick={() => handleDelete(r.id)}
                      className="p-1.5 rounded hover:bg-red-500/10 text-zinc-500 hover:text-red-300"
                      title="Apagar"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
