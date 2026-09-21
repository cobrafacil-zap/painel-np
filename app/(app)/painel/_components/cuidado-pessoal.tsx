'use client';

/**
 * Card "Cuidado pessoal" (#feature alimentação).
 *
 * Card unificado com 3 subcategorias:
 *   - Alimentação (ativa) — macros do dia + últimas refeições
 *   - Sono (placeholder) — em breve
 *   - Treino (placeholder) — em breve
 *
 * Alimentação:
 *   - Mostra 4 macros do dia com barra de progresso vs meta
 *   - Lista as últimas refeições com thumb + kcal
 *   - Botão "Editar meta" abre modal com input manual + opção
 *     "Calcular pela minha bio" (Harris-Benedict)
 */

import { useEffect, useState } from 'react';
import { Heart, Apple, Moon, Dumbbell, RefreshCw, Settings2, X } from 'lucide-react';
import { formatBRL } from '@/lib/utils';

type Tab = 'alimentacao' | 'sono' | 'treino';

interface Meta {
  meta_kcal: number | null;
  meta_protein_g: number | null;
  meta_carb_g: number | null;
  meta_fat_g: number | null;
  origem: 'auto' | 'manual' | 'hibrido';
}

interface ResumoDia {
  data: string;
  consumido: {
    kcal: number;
    protein_g: number;
    carb_g: number;
    fat_g: number;
    refeicoes_count: number;
  };
  meta: Meta | null;
  progresso: {
    kcal_pct: number;
    protein_pct: number;
    carb_pct: number;
    fat_pct: number;
  };
  refeicoes: Array<{
    id: string;
    occurred_at: string;
    meal_type: string | null;
    kcal: number | null;
    itens: Array<{ nome: string; gramas: number; kcal: number }>;
    signed_url: string | null;
  }>;
}

export function CuidadoPessoal() {
  const [tab, setTab] = useState<Tab>('alimentacao');
  const [resumo, setResumo] = useState<ResumoDia | null>(null);
  const [temBio, setTemBio] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showEditMeta, setShowEditMeta] = useState(false);

  async function load() {
    try {
      const [rRes, mRes] = await Promise.all([
        fetch('/api/nutricao/resumo').then((r) => r.json()),
        fetch('/api/nutricao/metas').then((r) => r.json()),
      ]);
      setResumo(rRes);
      setTemBio(mRes.tem_bio);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const tabs: Array<{ key: Tab; label: string; icon: any; disabled?: boolean }> = [
    { key: 'alimentacao', label: 'Alimentação', icon: Apple },
    { key: 'sono', label: 'Sono', icon: Moon, disabled: true },
    { key: 'treino', label: 'Treino', icon: Dumbbell, disabled: true },
  ];

  return (
    <div className="glass p-5 h-full">
      <header className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center shrink-0">
              <Heart className="w-3.5 h-3.5 text-rose-300" />
            </div>
            <p className="label-eyebrow">Cuidado pessoal</p>
          </div>
          <h2 className="text-lg font-semibold mt-2">Saúde do dia a dia</h2>
        </div>
        {tab === 'alimentacao' && (
          <button
            type="button"
            onClick={() => setShowEditMeta(true)}
            className="text-[11px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1 shrink-0"
          >
            <Settings2 className="w-3 h-3" />
            Meta
          </button>
        )}
      </header>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-white/[0.06]">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            disabled={t.disabled}
            onClick={() => !t.disabled && setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-t-md transition-colors ${
              tab === t.key
                ? 'bg-white/[0.04] text-zinc-100 border-b-2 border-rose-400'
                : t.disabled
                  ? 'text-zinc-600 cursor-not-allowed'
                  : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <t.icon className="w-3 h-3" />
            {t.label}
            {t.disabled && <span className="text-[9px] text-zinc-700">em breve</span>}
          </button>
        ))}
      </div>

      {tab === 'alimentacao' && (
        <AlimentacaoTab
          resumo={resumo}
          loading={loading}
          temBio={temBio}
          showEditMeta={showEditMeta}
          onCloseEdit={() => setShowEditMeta(false)}
          onSaved={() => {
            setShowEditMeta(false);
            setLoading(true);
            load();
          }}
        />
      )}

      {tab === 'sono' && <PlaceholderTab icon={Moon} label="Sono" />}
      {tab === 'treino' && <PlaceholderTab icon={Dumbbell} label="Treino" />}
    </div>
  );
}

function AlimentacaoTab({
  resumo,
  loading,
  temBio,
  showEditMeta,
  onCloseEdit,
  onSaved,
}: {
  resumo: ResumoDia | null;
  loading: boolean;
  temBio: boolean;
  showEditMeta: boolean;
  onCloseEdit: () => void;
  onSaved: () => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 rounded-md shimmer" />
        ))}
      </div>
    );
  }

  if (!resumo) {
    return (
      <p className="text-sm text-zinc-500 text-center py-6">
        Manda uma foto da comida no WhatsApp pra começar.
      </p>
    );
  }

  const macros = [
    {
      label: 'Calorias',
      atual: resumo.consumido.kcal,
      meta: resumo.meta?.meta_kcal,
      pct: resumo.progresso.kcal_pct,
      unit: 'kcal',
    },
    {
      label: 'Proteína',
      atual: resumo.consumido.protein_g,
      meta: resumo.meta?.meta_protein_g,
      pct: resumo.progresso.protein_pct,
      unit: 'g',
    },
    {
      label: 'Carboidrato',
      atual: resumo.consumido.carb_g,
      meta: resumo.meta?.meta_carb_g,
      pct: resumo.progresso.carb_pct,
      unit: 'g',
    },
    {
      label: 'Gordura',
      atual: resumo.consumido.fat_g,
      meta: resumo.meta?.meta_fat_g,
      pct: resumo.progresso.fat_pct,
      unit: 'g',
    },
  ];

  return (
    <>
      <div className="space-y-3">
        {macros.map((m) => {
          const cor =
            m.pct > 110
              ? 'bg-red-500'
              : m.pct >= 80
                ? 'bg-emerald-500'
                : m.pct >= 50
                  ? 'bg-amber-500'
                  : 'bg-zinc-600';
          return (
            <div key={m.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-300">{m.label}</span>
                <span className="num-tabular text-zinc-400">
                  {Math.round(m.atual)} / {m.meta ?? '—'} {m.unit}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                <div
                  className={`h-full ${cor} transition-all`}
                  style={{ width: `${Math.min(100, m.pct)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 pt-4 border-t border-white/[0.06]">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-zinc-400">
            {resumo.consumido.refeicoes_count === 0
              ? 'Nenhuma refeição registrada hoje.'
              : `${resumo.consumido.refeicoes_count} refeição${
                  resumo.consumido.refeicoes_count !== 1 ? 'ões' : ''
                } hoje`}
          </p>
        </div>
        <ul className="space-y-2 max-h-40 overflow-y-auto">
          {resumo.refeicoes.slice(0, 4).map((r) => {
            const hora = new Date(r.occurred_at).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            });
            return (
              <li
                key={r.id}
                className="flex items-center gap-2 text-xs py-1"
              >
                {r.signed_url ? (
                  <img
                    src={r.signed_url}
                    alt=""
                    className="w-8 h-8 rounded object-cover shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded bg-white/[0.04] shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-zinc-300 truncate">
                    {r.itens[0]?.nome ?? r.meal_type ?? 'Refeição'}
                    {r.itens.length > 1 && ` +${r.itens.length - 1}`}
                  </p>
                  <p className="text-[10px] text-zinc-600">
                    {hora} · {r.kcal ?? '?'} kcal
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {showEditMeta && (
        <EditMetaModal
          meta={resumo.meta}
          temBio={temBio}
          onClose={onCloseEdit}
          onSaved={onSaved}
        />
      )}
    </>
  );
}

function PlaceholderTab({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="text-center py-8">
      <Icon className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
      <p className="text-sm text-zinc-400">{label} em breve</p>
      <p className="text-[11px] text-zinc-600 mt-1">
        Funcionalidade prevista pra próxima fase.
      </p>
    </div>
  );
}

function EditMetaModal({
  meta,
  temBio,
  onClose,
  onSaved,
}: {
  meta: Meta | null;
  temBio: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kcal, setKcal] = useState(String(meta?.meta_kcal ?? 2200));
  const [prot, setProt] = useState(String(meta?.meta_protein_g ?? 120));
  const [carb, setCarb] = useState(String(meta?.meta_carb_g ?? 280));
  const [gord, setGord] = useState(String(meta?.meta_fat_g ?? 70));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(modo: 'manual' | 'auto') {
    setSaving(true);
    setError(null);
    try {
      const body =
        modo === 'manual'
          ? {
              modo: 'manual',
              metas: {
                meta_kcal: Number(kcal),
                meta_protein_g: Number(prot),
                meta_carb_g: Number(carb),
                meta_fat_g: Number(gord),
              },
            }
          : { modo: 'auto' };
      const r = await fetch('/api/nutricao/metas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json();
        setError(j.message ?? j.error ?? 'Erro ao salvar');
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="glass-elevated rounded-xl p-5 max-w-md w-full space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Metas nutricionais</h3>
          <button type="button" onClick={onClose} className="text-zinc-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {temBio && (
          <button
            type="button"
            disabled={saving}
            onClick={() => save('auto')}
            className="w-full flex items-center justify-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-md py-2 text-sm hover:bg-emerald-500/20 disabled:opacity-50"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Calcular pela minha bio (Harris-Benedict)
          </button>
        )}

        {!temBio && (
          <p className="text-[11px] text-zinc-500">
            Preencha altura, peso, idade e sexo no seu perfil pra liberar o cálculo automático.
          </p>
        )}

        <div className="border-t border-white/[0.06] pt-3 space-y-2">
          <p className="text-[11px] text-zinc-500">Ou preencha manualmente:</p>
          {[
            { label: 'Calorias (kcal)', val: kcal, set: setKcal },
            { label: 'Proteína (g)', val: prot, set: setProt },
            { label: 'Carboidrato (g)', val: carb, set: setCarb },
            { label: 'Gordura (g)', val: gord, set: setGord },
          ].map((f) => (
            <label key={f.label} className="block text-xs">
              <span className="text-zinc-400">{f.label}</span>
              <input
                type="number"
                value={f.val}
                onChange={(e) => f.set(e.target.value)}
                className="w-full mt-1 bg-white/[0.04] border border-white/[0.06] rounded px-2 py-1.5 text-sm num-tabular"
                min="0"
              />
            </label>
          ))}
        </div>

        {error && <p className="text-xs text-red-300">{error}</p>}

        <button
          type="button"
          disabled={saving}
          onClick={() => save('manual')}
          className="w-full bg-rose-500/20 border border-rose-500/30 text-rose-200 rounded-md py-2 text-sm hover:bg-rose-500/30 disabled:opacity-50"
        >
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </div>
  );
}
