'use client';

import { useEffect, useState } from 'react';
import { formatBRL } from '@/lib/utils';
import { Sparkles, Calendar } from 'lucide-react';
import { useCountUp } from '@/lib/hooks/use-count-up';

interface Pattern {
  pattern_key: string;
  pattern_type: string;
  avg_amount: number;
  next_expected_date: string;
  next_expected_amount: number | null;
  day_of_month: number | null;
  frequency: string;
  sample_count: number;
}

const LABEL: Record<string, string> = {
  aluguel: 'Aluguel',
  condominio: 'Condomínio',
  iptu: 'IPTU',
  financiamento: 'Financiamento',
  luz: 'Luz',
  agua: 'Água',
  gas: 'Gás',
  internet: 'Internet',
  telefone: 'Telefone',
  tv: 'TV',
  netflix: 'Netflix',
  spotify: 'Spotify',
  academia: 'Academia',
  plano_saude: 'Plano de saúde',
};

function diasAte(iso: string): number {
  const alvo = new Date(iso + 'T00:00:00');
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((alvo.getTime() - hoje.getTime()) / 86400000);
}

function categoriaDaKey(key: string): string {
  // "contas_casa:luz" → "contas_casa"
  const [cat, kw] = key.split(':');
  return LABEL[kw] ?? kw ?? cat;
}

export function PadroesPrevistos() {
  const [patterns, setPatterns] = useState<Pattern[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/financeiro/padroes-previstos')
      .then((r) => r.json())
      .then((d) => setPatterns(d.patterns ?? []))
      .catch(() => setPatterns([]))
      .finally(() => setLoading(false));
  }, []);

  const list = patterns ?? [];
  const total = list.reduce(
    (s, p) => s + Number(p.next_expected_amount ?? p.avg_amount),
    0
  );
  const displayTotal = useCountUp(loading ? 0 : total);

  if (loading) {
    return (
      <div className="glass p-5 h-full">
        <div className="space-y-3">
          <div className="h-5 w-32 rounded shimmer" />
          <div className="h-8 w-24 rounded shimmer" />
          <div className="space-y-2 mt-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 rounded-md shimmer" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="glass p-5 h-full flex flex-col items-center justify-center text-center py-8">
        <Sparkles className="w-8 h-8 text-zinc-700 mb-2" />
        <p className="text-sm text-zinc-400">Sem padrões identificados ainda.</p>
        <p className="text-[11px] text-zinc-600 mt-1">
          Após alguns meses registrando contas, o painel começa a projetar seus
          gastos fixos aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="glass p-5 h-full">
      <header className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-violet-300" />
            </div>
            <p className="label-eyebrow">Previsão (próx. 30 dias)</p>
          </div>
          <h2 className="text-lg font-semibold mt-2">Gastos previstos</h2>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xl sm:text-2xl font-bold num-tabular text-violet-300">
            {formatBRL(displayTotal)}
          </p>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {list.length} conta{list.length !== 1 ? 's' : ''}
          </p>
        </div>
      </header>

      <ul className="space-y-1.5">
        {list.map((p) => {
          const label = categoriaDaKey(p.pattern_key);
          const dias = diasAte(p.next_expected_date);
          const valor = Number(p.next_expected_amount ?? p.avg_amount);
          const labelVenc =
            dias < 0
              ? `${Math.abs(dias)}d atrasado`
              : dias === 0
                ? 'hoje'
                : dias === 1
                  ? 'amanhã'
                  : `em ${dias}d`;
          return (
            <li
              key={p.pattern_key}
              className="flex items-center justify-between gap-3 px-2.5 py-2 rounded-md hover:bg-white/[0.025] transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Calendar className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                <span className="text-sm text-zinc-200 truncate">{label}</span>
                {p.sample_count > 1 && (
                  <span className="text-[10px] text-zinc-600 shrink-0">
                    ({p.sample_count}×)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-[11px] text-zinc-500 num-tabular">
                  {labelVenc}
                </span>
                <span className="text-sm font-medium num-tabular text-zinc-100 w-20 text-right">
                  {formatBRL(valor)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
