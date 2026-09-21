'use client';

/**
 * Simulador "se eu quiser juntar X em Y meses" (#overhaul metas-largas).
 *
 * Client island: 2 inputs (valor + prazo em meses/anos) e resultado
 * ao vivo de "quanto precisa guardar por mês". Não persiste — só
 * simula. Pra criar a meta de fato, fala no WhatsApp.
 */

import { useState } from 'react';
import { Calculator, X } from 'lucide-react';
import { formatBRL } from '@/lib/utils';

export function SimuladorMetaLonga() {
  const [open, setOpen] = useState(false);
  const [valor, setValor] = useState('100000');
  const [anos, setAnos] = useState('5');

  const valorNum = parseFloat(valor.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
  const anosNum = parseFloat(anos) || 0;
  const meses = anosNum * 12;
  const parcela = meses > 0 ? valorNum / meses : 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="shrink-0 inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors px-2.5 h-7 rounded-full bg-white/[0.04] border border-border"
      >
        <Calculator className="w-3 h-3" />
        Simular
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="glass-elevated p-5 sm:p-6 w-full sm:max-w-md sm:rounded-lg rounded-t-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="label-eyebrow">Simulador</p>
                <h3 className="text-lg font-semibold mt-1">Se eu quiser juntar…</h3>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-white/[0.06] text-zinc-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-zinc-400">Valor (R$)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder="100000"
                  className="mt-1 w-full h-11 px-3 rounded-lg bg-bg-base border border-border focus:border-emerald-500 focus:outline-none text-base num-tabular"
                />
              </label>

              <label className="block">
                <span className="text-xs text-zinc-400">Em quantos anos?</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.5"
                  step="0.5"
                  value={anos}
                  onChange={(e) => setAnos(e.target.value)}
                  placeholder="5"
                  className="mt-1 w-full h-11 px-3 rounded-lg bg-bg-base border border-border focus:border-emerald-500 focus:outline-none text-base num-tabular"
                />
              </label>
            </div>

            {valorNum > 0 && meses > 0 && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4">
                <p className="text-xs text-emerald-300 mb-1">Pra bater no prazo:</p>
                <p className="text-2xl font-bold num-tabular text-emerald-200">
                  {formatBRL(parcela)}/mês
                </p>
                <p className="text-[11px] text-zinc-500 mt-2">
                  Em {meses} meses ({anosNum} anos), guardando todo mês.
                </p>
              </div>
            )}

            <p className="text-[11px] text-zinc-600">
              Pra criar a meta de fato, manda no WhatsApp:{' '}
              <span className="text-zinc-400">
                &ldquo;quero juntar {formatBRL(valorNum || 0)} em {meses || 0} meses&rdquo;
              </span>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
