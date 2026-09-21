'use client';

/**
 * Card "Planejamento de renda passiva" (#feature renda-passiva).
 *
 * Mostra:
 *   - Input: renda mensal desejada (R$)
 *   - Input: % da receita média a investir (default 10%, editável)
 *   - Auto-fill: receita média últimos 3 meses (carregada da API)
 *   - Tabela com 4 cenários (Conservador/Moderado/Agressivo/Cripto):
 *       - Capital necessário HOJE
 *       - Aporte mensal sugerido (receita × pct/100)
 *       - Meses/anos até atingir com aporte
 *
 * Estado persiste em localStorage pra não perder entre sessões.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  TrendingUp,
  Sparkles,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Calendar,
  Wallet,
} from 'lucide-react';
import { formatBRL } from '@/lib/utils';
import { simularRendaPassiva, formatarPrazo, type LinhaCenario } from '@/lib/financeiro/renda-passiva';

const STORAGE_KEY = 'painel-np:renda-passiva:v1';

interface EstadoSalvo {
  rendaAlvo: number;
  pctDaReceita: number;
  receitaMedia3m: number;
  expanded: boolean;
}

const ESTADO_DEFAULT: EstadoSalvo = {
  rendaAlvo: 3000,
  pctDaReceita: 10,
  receitaMedia3m: 0,
  expanded: true,
};

export function RendaPassivaCard() {
  const [estado, setEstado] = useState<EstadoSalvo>(ESTADO_DEFAULT);
  const [carregado, setCarregado] = useState(false);

  // Carrega do localStorage E busca receita média
  useEffect(() => {
    let mounted = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
          setEstado((e) => ({ ...e, ...parsed }));
        }
      }
    } catch {
      // localStorage indisponível (modo anônimo, etc) — usa defaults
    }

    fetch('/api/financeiro/renda-passiva')
      .then((r) => r.json())
      .then((j) => {
        if (!mounted) return;
        if (typeof j.receita_media_3m === 'number') {
          setEstado((e) => ({
            ...e,
            receitaMedia3m: j.receita_media_3m,
          }));
        }
      })
      .catch(() => {})
      .finally(() => mounted && setCarregado(true));

    return () => {
      mounted = false;
    };
  }, []);

  // Persiste no localStorage sempre que mudar
  useEffect(() => {
    if (!carregado) return; // não persistir antes do primeiro load
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(estado));
    } catch {
      // ignore
    }
  }, [estado, carregado]);

  const aporteSugerido = useMemo(
    () => Math.round(estado.receitaMedia3m * (estado.pctDaReceita / 100) * 100) / 100,
    [estado.receitaMedia3m, estado.pctDaReceita],
  );

  const linhas: LinhaCenario[] = useMemo(
    () =>
      simularRendaPassiva({
        rendaMensalDesejada: estado.rendaAlvo,
        aporteMensal: aporteSugerido,
      }),
    [estado.rendaAlvo, aporteSugerido],
  );

  const temReceita = estado.receitaMedia3m > 0;

  return (
    <div className="glass-elevated rounded-xl overflow-hidden">
      {/* Header clicável */}
      <button
        type="button"
        onClick={() => setEstado({ ...estado, expanded: !estado.expanded })}
        className="w-full px-5 py-4 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5 text-emerald-300" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="label-eyebrow">Planejamento</p>
              <span className="text-[9px] uppercase tracking-wide bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                renda passiva
              </span>
            </div>
            <h2 className="text-base sm:text-lg font-semibold mt-0.5 truncate">
              Quanto preciso pra parar de trabalhar?
            </h2>
          </div>
        </div>
        {estado.expanded ? (
          <ChevronUp className="w-4 h-4 text-zinc-500 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" />
        )}
      </button>

      {estado.expanded && (
        <div className="px-5 pb-5 space-y-5 border-t border-white/[0.06]">
          {/* Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-5">
            <div>
              <label className="block">
                <span className="text-[10px] text-zinc-500 uppercase tracking-wide">
                  Renda mensal desejada
                </span>
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-sm text-zinc-500">R$</span>
                  <input
                    type="number"
                    value={estado.rendaAlvo}
                    onChange={(e) =>
                      setEstado({ ...estado, rendaAlvo: Number(e.target.value) || 0 })
                    }
                    min={0}
                    step={100}
                    className="w-full bg-white/[0.04] border border-white/[0.06] rounded px-2 py-1.5 text-sm num-tabular focus:outline-none focus:border-emerald-400/40"
                  />
                </div>
              </label>
            </div>

            <div>
              <label className="block">
                <span className="text-[10px] text-zinc-500 uppercase tracking-wide">
                  % da receita a investir
                </span>
                <div className="flex items-center gap-1 mt-1">
                  <input
                    type="number"
                    value={estado.pctDaReceita}
                    onChange={(e) =>
                      setEstado({
                        ...estado,
                        pctDaReceita: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    min={0}
                    max={100}
                    step={1}
                    className="w-full bg-white/[0.04] border border-white/[0.06] rounded px-2 py-1.5 text-sm num-tabular focus:outline-none focus:border-emerald-400/40"
                  />
                  <span className="text-sm text-zinc-500">%</span>
                </div>
              </label>
            </div>

            <div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Aporte sugerido</p>
              <p className="mt-1 text-lg font-semibold num-tabular text-emerald-300 flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5" />
                {formatBRL(aporteSugerido)}
                <span className="text-[10px] font-normal text-zinc-500">/mês</span>
              </p>
              <p className="text-[10px] text-zinc-600 mt-0.5">
                baseado na sua receita média
              </p>
            </div>
          </div>

          {/* Resumo leitura receita média */}
          <div className="rounded-md bg-emerald-500/[0.04] border border-emerald-500/[0.12] px-3 py-2 text-xs flex items-start gap-2">
            <Sparkles className="w-3.5 h-3.5 text-emerald-300 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              {temReceita ? (
                <p className="text-zinc-300">
                  Sua receita média dos últimos 3 meses é{' '}
                  <span className="font-semibold text-zinc-100 num-tabular">
                    {formatBRL(estado.receitaMedia3m)}
                  </span>
                  . Investindo {estado.pctDaReceita}% dela ({formatBRL(aporteSugerido)}/mês) você
                  chega à independência financeira em alguns cenários abaixo:
                </p>
              ) : (
                <p className="text-zinc-400">
                  Sem receita registrada nos últimos 3 meses. Cadastre receitas pelo WhatsApp ou no
                  formulário de lançamento. Aporte sugerido será preenchido assim que tiver dados.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() =>
                setEstado({ ...ESTADO_DEFAULT, expanded: true, receitaMedia3m: estado.receitaMedia3m })
              }
              className="shrink-0 text-zinc-500 hover:text-zinc-300"
              title="Limpar"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Tabela de cenários */}
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="text-[10px] text-zinc-500 uppercase tracking-wide border-b border-white/[0.06]">
                  <th className="text-left py-2 pr-2 font-medium">Cenário</th>
                  <th className="text-right py-2 px-2 font-medium">Taxa a.m.</th>
                  <th className="text-right py-2 px-2 font-medium hidden sm:table-cell">
                    Capital HOJE
                  </th>
                  <th className="text-right py-2 pl-2 font-medium">Tempo p/ atingir</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr
                    key={l.cenario.id}
                    className="border-b border-white/[0.04] last:border-b-0 hover:bg-white/[0.02]"
                  >
                    <td className="py-3 pr-2">
                      <p className="font-medium text-zinc-100">{l.cenario.label}</p>
                      <p className="text-[10px] text-zinc-500 mt-0.5 line-clamp-1">
                        {l.cenario.descricao}
                      </p>
                    </td>
                    <td className="text-right py-3 px-2 num-tabular text-zinc-300">
                      {(l.cenario.taxa_mensal * 100).toFixed(1).replace('.', ',')}%
                    </td>
                    <td className="text-right py-3 px-2 num-tabular text-zinc-200 hidden sm:table-cell font-semibold">
                      {formatBRL(Math.round(l.capital_necessario))}
                    </td>
                    <td className="text-right py-3 pl-2">
                      {l.cenario.id === 'cripto' || aporteSugerido > 0 ? (
                        l.meses_ate_atingir != null ? (
                          <span className="inline-flex items-center gap-1 text-zinc-200 num-tabular">
                            <Calendar className="w-3 h-3 text-zinc-500" />
                            {formatarPrazo(l.meses_ate_atingir)}
                          </span>
                        ) : (
                          <span className="text-zinc-500 text-[10px]">sem aporte</span>
                        )
                      ) : (
                        <span className="text-zinc-500 text-[10px]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[10px] text-zinc-600 leading-relaxed">
            Os cálculos usam juros compostos. Taxas são estimativas líquidas (após IR para
            investimentos tributados). Valores não constituem recomendação de investimento —
            apenas ferramenta pra você visualizar o que precisa acumular. O aporte é calculado
            sobre sua{' '}
            <span className="text-zinc-400">receita média</span>, não sobre o que sobra no fim do
            mês.
          </p>
        </div>
      )}
    </div>
  );
}
