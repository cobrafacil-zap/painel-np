'use client';

/**
 * Histórico de refeições (#feature cuidado pessoal).
 *
 * Lista paginada dos últimos N dias (default 14). Permite filtrar
 * intervalos simples (7/14/30).
 */

import { useEffect, useState } from 'react';
import { Camera, ScrollText } from 'lucide-react';

interface Refeicao {
  id: string;
  occurred_at: string;
  meal_type: string | null;
  kcal: number | null;
  itens: unknown;
  confidence: number | null;
  descricao_user: string | null;
}

export function HistoricoRefeicoes() {
  const [dias, setDias] = useState(7);
  const [rows, setRows] = useState<Refeicao[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/cuidado-pessoal/historico?dias=${dias}`);
      const j = await r.json();
      setRows(j.refeicoes ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dias]);

  const intervalos = [
    { value: 7, label: '7 dias' },
    { value: 14, label: '14 dias' },
    { value: 30, label: '30 dias' },
  ];

  return (
    <section className="glass-elevated rounded-xl p-5">
      <header className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
            <ScrollText className="w-3.5 h-3.5 text-amber-300" />
          </div>
          <div>
            <p className="label-eyebrow">Histórico</p>
            <h2 className="text-lg font-semibold mt-1">Refeições registradas</h2>
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          {intervalos.map((i) => (
            <button
              key={i.value}
              type="button"
              onClick={() => setDias(i.value)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                dias === i.value
                  ? 'bg-amber-500/20 text-amber-200 border border-amber-500/30'
                  : 'bg-white/[0.04] text-zinc-400 hover:text-zinc-200 border border-white/[0.06]'
              }`}
            >
              {i.label}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-md shimmer" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-8">
          <Camera className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
          <p className="text-sm text-zinc-400">Nenhuma refeição nesse período</p>
          <p className="text-[11px] text-zinc-600 mt-1">
            As refeições aparecem aqui assim que você manda foto no WhatsApp
          </p>
        </div>
      ) : (
        <ul className="space-y-2 max-h-[28rem] overflow-y-auto">
          {rows.map((r) => {
            const hora = new Date(r.occurred_at).toLocaleString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            });
            const itensArr = Array.isArray(r.itens) ? r.itens : [];
            const itensNomes = itensArr
              .map((i: any) => (typeof i === 'string' ? i : i?.nome))
              .filter(Boolean);
            return (
              <li
                key={r.id}
                className="flex items-center gap-3 text-xs py-2 px-3 rounded-md bg-white/[0.03] border border-white/[0.04]"
              >
                <div className="w-10 h-10 rounded bg-white/[0.04] shrink-0 flex items-center justify-center">
                  <Camera className="w-4 h-4 text-zinc-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-zinc-200 truncate">
                    {itensNomes.slice(0, 3).join(', ') ||
                      r.descricao_user ||
                      r.meal_type ||
                      'Refeição'}
                    {itensNomes.length > 3 && ` +${itensNomes.length - 3}`}
                  </p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    {hora} ·{' '}
                    <span className="num-tabular">{r.kcal ?? '?'} kcal</span>
                    {r.meal_type && (
                      <span className="ml-2 capitalize">· {r.meal_type}</span>
                    )}
                  </p>
                </div>
                {r.confidence != null && (
                  <span className="text-[10px] text-zinc-600 num-tabular shrink-0">
                    {Math.round(Number(r.confidence) * 100)}%
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
