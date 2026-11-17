'use client';

/**
 * Investimentos por categoria — Reserva · Imobiliário · Ações.
 * Sem projeção/cenário: só total por categoria + aportes.
 */

import { useEffect, useState } from 'react';
import {
  CATEGORIAS_INVESTIMENTO,
  type CategoriaInvestimento,
} from '@/lib/financeiro/investimentos';
import { formatBRL } from '@/lib/utils';
import { ShieldCheck, Building2, TrendingUp, Trash2, Check, X } from 'lucide-react';

interface Deposito {
  id: string;
  categoria: CategoriaInvestimento;
  valor: number | string;
  descricao: string | null;
  occurred_at: string;
}

const ICONES: Record<
  CategoriaInvestimento,
  React.ComponentType<{ className?: string; style?: React.CSSProperties }>
> = {
  reserva: ShieldCheck,
  imobiliario: Building2,
  acoes: TrendingUp,
};

export function InvestimentosView() {
  const [totais, setTotais] = useState<Record<CategoriaInvestimento, number>>({
    reserva: 0,
    imobiliario: 0,
    acoes: 0,
  });
  const [depositos, setDepositos] = useState<Deposito[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Form de aporte
  const [categoria, setCategoria] = useState<CategoriaInvestimento>('reserva');
  const [valor, setValor] = useState('');
  const [descricao, setDescricao] = useState('');
  const [saving, setSaving] = useState(false);

  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/financeiro/investimentos')
      .then((r) => r.json())
      .then((d) => {
        setTotais(d.totais ?? { reserva: 0, imobiliario: 0, acoes: 0 });
        setDepositos(d.depositos ?? []);
      })
      .finally(() => setLoading(false));
  }, [refreshKey]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function aportar(e: React.FormEvent) {
    e.preventDefault();
    const v = Number(valor.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) {
      flash('⚠️ Informe um valor válido.');
      return;
    }
    setSaving(true);
    const res = await fetch('/api/financeiro/investimentos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoria, valor: v, descricao: descricao.trim() || null }),
    });
    setSaving(false);
    if (res.ok) {
      flash(`✅ Aporte de ${formatBRL(v)} registrado.`);
      setValor('');
      setDescricao('');
      setRefreshKey((k) => k + 1);
    } else {
      flash('⚠️ Erro ao registrar aporte.');
    }
  }

  async function apagar(id: string) {
    const res = await fetch(`/api/financeiro/investimentos/${id}`, { method: 'DELETE' });
    setConfirmandoId(null);
    if (res.ok) {
      flash('🗑️ Aporte apagado.');
      setRefreshKey((k) => k + 1);
    } else {
      flash('⚠️ Erro ao apagar.');
    }
  }

  const totalGeral = totais.reserva + totais.imobiliario + totais.acoes;

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Cards por categoria */}
      <div className="grid gap-4 md:grid-cols-3">
        {CATEGORIAS_INVESTIMENTO.map((c) => {
          const Icone = ICONES[c.value];
          return (
            <div key={c.value} className="glass p-5 card-hover-lift">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-9 h-9 rounded-lg border flex items-center justify-center"
                  style={{ background: `${c.cor}1a`, borderColor: `${c.cor}33` }}
                >
                  <Icone className="w-4 h-4" style={{ color: c.cor }} />
                </div>
                <p className="label-eyebrow">{c.label}</p>
              </div>
              <p className="text-2xl sm:text-3xl font-bold num-tabular mt-3 text-zinc-100 break-words">
                {formatBRL(totais[c.value] ?? 0)}
              </p>
            </div>
          );
        })}
      </div>

      {/* Resumo + form de aporte */}
      <div className="glass p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h3 className="font-semibold">Registrar aporte</h3>
          <p className="text-sm text-zinc-500">
            Total investido:{' '}
            <span className="text-zinc-200 font-semibold num-tabular">
              {formatBRL(totalGeral)}
            </span>
          </p>
        </div>

        <form onSubmit={aportar} className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            {CATEGORIAS_INVESTIMENTO.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCategoria(c.value)}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors border ${
                  categoria === c.value
                    ? 'border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-200'
                    : 'border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:border-white/[0.15]'
                }`}
              >
                {c.label.replace('Investimento ', '')}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
            <input
              type="text"
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="Valor (ex: 500)"
              className="px-3.5 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.08] text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/40"
            />
            <input
              type="text"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Descrição (opcional)"
              className="px-3.5 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.08] text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/40"
            />
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Salvando…' : 'Aportar'}
            </button>
          </div>
        </form>
      </div>

      {/* Aportes */}
      <div className="glass p-5 relative">
        <h3 className="font-semibold mb-3">Aportes</h3>
        {loading ? (
          <p className="text-sm text-zinc-500">Carregando…</p>
        ) : depositos.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Nenhum aporte ainda. Use o formulário acima pra começar.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
            <thead className="text-zinc-500">
              <tr className="text-left text-xs">
                <th className="font-medium pb-2">Data</th>
                <th className="font-medium pb-2">Categoria</th>
                <th className="font-medium pb-2">Descrição</th>
                <th className="font-medium pb-2 text-right">Valor</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody>
              {depositos.map((d) => {
                const cat = CATEGORIAS_INVESTIMENTO.find((c) => c.value === d.categoria);
                return (
                  <tr key={d.id} className="border-t border-white/[0.05]">
                    <td className="py-2.5 text-zinc-400 whitespace-nowrap">
                      {new Date(d.occurred_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="py-2.5">
                      <span className="inline-flex items-center gap-2 text-zinc-300">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: cat?.cor ?? '#6b7280' }}
                        />
                        {cat?.label.replace('Investimento ', '') ?? d.categoria}
                      </span>
                    </td>
                    <td className="py-2.5 text-zinc-400 truncate">{d.descricao ?? '—'}</td>
                    <td className="py-2.5 text-right font-medium num-tabular text-zinc-100">
                      {formatBRL(Number(d.valor))}
                    </td>
                    <td className="py-2.5 text-right">
                      {confirmandoId === d.id ? (
                        <div className="flex gap-1 justify-end">
                          <button
                            onClick={() => apagar(d.id)}
                            className="p-1.5 rounded bg-red-500/15 text-red-300 hover:bg-red-500/25 transition-colors"
                            title="Confirmar"
                            aria-label="Confirmar exclusão"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setConfirmandoId(null)}
                            className="p-1.5 rounded hover:bg-bg-elevated text-zinc-400 transition-colors"
                            title="Cancelar"
                            aria-label="Cancelar"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmandoId(d.id)}
                          className="p-1.5 rounded hover:bg-red-500/10 text-zinc-500 hover:text-red-300 transition-colors"
                          title="Apagar aporte"
                          aria-label="Apagar aporte"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
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
    </div>
  );
}
