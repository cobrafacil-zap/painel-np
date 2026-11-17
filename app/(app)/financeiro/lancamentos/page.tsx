'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase/client';
import type { FinanceRecord } from '@/lib/types';
import { LancamentoForm } from '../_components/lancamento-form';
import { formatBRL, formatDateBR } from '@/lib/utils';
import { labelForma } from '@/lib/financeiro/formas-pagamento';
import { Trash2, Pencil, ChevronUp, ChevronDown } from 'lucide-react';

type OrdemCol = 'occurred_at' | 'description' | 'category' | 'payment_method' | 'amount';

// Lazy-load: drawer só baixa quando o usuário abre pra editar.
// Evita inflar o bundle da list page com forms.
const EditLancamentoDrawer = dynamic(
  () =>
    import('../_components/edit-lancamento-drawer').then((m) => ({
      default: m.EditLancamentoDrawer,
    })),
  { ssr: false },
);

export default function LancamentosPage() {
  const [records, setRecords] = useState<FinanceRecord[]>([]);
  const [catMap, setCatMap] = useState<Record<string, { label: string; color: string | null }>>({});
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<FinanceRecord | null>(null);
  const [editing, setEditing] = useState<FinanceRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Ordenação da tabela — clique no cabeçalho (padrão: data, mais recente primeiro)
  const [ordem, setOrdem] = useState<{ col: OrdemCol; asc: boolean }>({
    col: 'occurred_at',
    asc: false,
  });

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

  // Categorias (slug → label/color) pra exibir a coluna Categoria bonitinha
  useEffect(() => {
    createClient()
      .from('categories')
      .select('slug, label, color')
      .eq('module_id', 'financeiro')
      .then(({ data }) => {
        const map: Record<string, { label: string; color: string | null }> = {};
        for (const c of data ?? []) map[c.slug] = { label: c.label, color: c.color };
        setCatMap(map);
      });
  }, []);

  function labelCategoria(slug: string): string {
    return (
      catMap[slug]?.label ??
      slug.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
    );
  }

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function alternarOrdenacao(col: OrdemCol) {
    setOrdem((o) =>
      o.col === col
        ? { col, asc: !o.asc }
        : // Texto começa A→Z; data e valor começam do maior/recente
          {
            col,
            asc: col === 'description' || col === 'category' || col === 'payment_method',
          },
    );
  }

  const registrosOrdenados = useMemo(() => {
    const arr = [...records];
    arr.sort((a, b) => {
      let cmp = 0;
      if (ordem.col === 'amount') {
        cmp = Number(a.amount) - Number(b.amount);
      } else if (ordem.col === 'occurred_at') {
        cmp = (a.occurred_at ?? '').localeCompare(b.occurred_at ?? '');
      } else if (ordem.col === 'payment_method') {
        cmp = labelForma(a.payment_method).localeCompare(
          labelForma(b.payment_method),
          'pt-BR',
          { sensitivity: 'base' },
        );
      } else {
        const va =
          (ordem.col === 'category'
            ? a.category
              ? labelCategoria(a.category)
              : ''
            : a.description) ?? '';
        const vb =
          (ordem.col === 'category'
            ? b.category
              ? labelCategoria(b.category)
              : ''
            : b.description) ?? '';
        cmp = va.localeCompare(vb, 'pt-BR', { sensitivity: 'base' });
      }
      if (cmp !== 0) return ordem.asc ? cmp : -cmp;
      // Desempate: mais recente primeiro
      return (b.created_at ?? '').localeCompare(a.created_at ?? '');
    });
    return arr;
  }, [records, ordem, catMap]);

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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-bg-elevated text-zinc-400">
              <tr>
                <ThOrdenavel col="occurred_at" label="Data" ordem={ordem} onClick={alternarOrdenacao} />
                <ThOrdenavel col="description" label="Descrição" ordem={ordem} onClick={alternarOrdenacao} />
                <ThOrdenavel col="category" label="Categoria" ordem={ordem} onClick={alternarOrdenacao} />
                <ThOrdenavel col="payment_method" label="Tipo" ordem={ordem} onClick={alternarOrdenacao} />
                <ThOrdenavel col="amount" label="Valor" ordem={ordem} onClick={alternarOrdenacao} align="right" />
                <th className="text-right px-4 py-2.5 font-medium">Origem</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody>
              {registrosOrdenados.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-bg-elevated/50">
                  <td className="px-4 py-2.5 text-zinc-400 whitespace-nowrap">{formatDateBR(r.occurred_at)}</td>
                  <td className="px-4 py-2.5">{r.description ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    {r.category ? (
                      <span className="inline-flex items-center gap-2 text-zinc-300">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: catMap[r.category]?.color ?? '#6b7280' }}
                        />
                        {labelCategoria(r.category)}
                      </span>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-400">{labelForma(r.payment_method)}</td>
                  <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${r.type === 'receita' ? 'text-emerald-300' : 'text-red-300'}`}>
                    {r.type === 'receita' ? '+' : '−'} {formatBRL(Number(r.amount))}
                  </td>
                  <td className="px-4 py-2.5 text-right text-zinc-500 text-xs">
                    {r.source === 'whatsapp' ? '📱 WhatsApp' : r.source}
                  </td>
                  <td className="px-2">
                    <div className="flex gap-0.5">
                      <button
                        onClick={() => setEditing(r)}
                        className="p-2 sm:p-1.5 rounded hover:bg-bg-elevated text-zinc-500 hover:text-zinc-200 transition-colors"
                        title="Editar lançamento"
                        aria-label="Editar lançamento"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setPendingDelete(r)}
                        className="p-2 sm:p-1.5 rounded hover:bg-red-500/10 text-zinc-500 hover:text-red-300 transition-colors"
                        title="Apagar lançamento"
                        aria-label="Apagar lançamento"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}

        {toast && (
          <div className="absolute bottom-4 right-4 bg-bg-elevated border border-border rounded-lg px-4 py-2.5 text-sm shadow-lg fade-in-up">
            {toast}
          </div>
        )}
      </div>

      {/* Confirmação de exclusão — bottom-sheet no mobile, centralizado no desktop */}
      {pendingDelete && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => !deleting && setPendingDelete(null)}
        >
          <div
            className="bg-bg-elevated rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 sm:p-6 space-y-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
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
                className="px-4 py-2 rounded-lg text-sm hover:bg-bg-base disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-sm bg-red-500/20 text-red-300 hover:bg-red-500/30 disabled:opacity-50"
              >
                {deleting ? 'Apagando…' : 'Apagar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drawer de edição — mobile-first (bottom-sheet) */}
      <EditLancamentoDrawer
        record={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          flash('✅ Lançamento atualizado.');
          setRefreshKey((k) => k + 1);
        }}
      />
    </div>
  );
}

/** Cabeçalho de coluna ordenável — 1 clique ordena, 2º clique inverte. */
function ThOrdenavel({
  col,
  label,
  ordem,
  onClick,
  align = 'left',
}: {
  col: OrdemCol;
  label: string;
  ordem: { col: OrdemCol; asc: boolean };
  onClick: (col: OrdemCol) => void;
  align?: 'left' | 'right';
}) {
  const ativo = ordem.col === col;
  return (
    <th className={`px-4 py-2.5 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => onClick(col)}
        className={`inline-flex items-center gap-1 hover:text-zinc-200 transition-colors ${
          ativo ? 'text-zinc-200' : ''
        } ${align === 'right' ? 'flex-row-reverse' : ''}`}
        title={`Ordenar por ${label}`}
      >
        {label}
        {ativo ? (
          ordem.asc ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )
        ) : (
          <ChevronUp className="w-3.5 h-3.5 opacity-30" />
        )}
      </button>
    </th>
  );
}
