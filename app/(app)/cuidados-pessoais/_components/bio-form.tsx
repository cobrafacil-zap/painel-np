'use client';

/**
 * Formulário de bio (#feature cuidado pessoal).
 *
 * Edita `profiles.altura_cm/peso_kg/idade/sexo`. Inline editing com:
 *   - Click em "Editar" revela campos
 *   - Salvar via PUT /api/cuidado-pessoal/bio
 *   - Cancelar reverte os valores
 *   - Quando bio é completa, recalcula metas automáticas (se já eram 'auto')
 */

import { useState } from 'react';
import { Pencil, Save, X, Check, Ruler, Weight, Cake, UserRound } from 'lucide-react';

interface Bio {
  altura_cm: number | null;
  peso_kg: number | null;
  idade: number | null;
  sexo: 'M' | 'F' | null;
}

export function BioForm({ initial }: { initial: Bio }) {
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState<Bio>(initial);
  const [draft, setDraft] = useState<Bio>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(0);

  function startEdit() {
    setDraft(bio);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setDraft(bio);
    setError(null);
    setEditing(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/cuidado-pessoal/bio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          altura_cm: draft.altura_cm,
          peso_kg: draft.peso_kg,
          idade: draft.idade,
          sexo: draft.sexo,
        }),
      });
      const json = await r.json();
      if (!r.ok) {
        setError(msgFromCode(json.error));
        return;
      }
      setBio(draft);
      setSavedTick((n) => n + 1);
      setEditing(false);
    } catch {
      setError('Erro de conexão');
    } finally {
      setSaving(false);
    }
  }

  const temBio =
    bio.altura_cm != null &&
    bio.peso_kg != null &&
    bio.idade != null &&
    bio.sexo != null;

  return (
    <div className="glass-elevated rounded-xl p-5">
      <header className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="label-eyebrow">Bio</p>
          <h2 className="text-lg font-semibold mt-1">Seus dados</h2>
          <p className="text-xs text-zinc-500 mt-1">
            Usamos pra calcular suas metas nutricionais automaticamente (Harris-Benedict).
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={startEdit}
            className="flex items-center gap-1.5 text-xs text-zinc-300 hover:text-zinc-100 px-2.5 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.06]"
          >
            <Pencil className="w-3 h-3" />
            {temBio ? 'Editar' : 'Preencher'}
          </button>
        )}
      </header>

      {savedTick > 0 && (
        <div className="mb-3 flex items-center gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
          <Check className="w-3.5 h-3.5" />
          Bio salva com sucesso.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Campo
          label="Altura"
          icon={<Ruler className="w-3.5 h-3.5" />}
          value={bio.altura_cm}
          suffix="cm"
          editing={editing}
          draft={draft.altura_cm}
          onDraft={(v) => setDraft({ ...draft, altura_cm: v })}
          step={1}
        />
        <Campo
          label="Peso"
          icon={<Weight className="w-3.5 h-3.5" />}
          value={bio.peso_kg}
          suffix="kg"
          editing={editing}
          draft={draft.peso_kg}
          onDraft={(v) => setDraft({ ...draft, peso_kg: v })}
          step={0.1}
        />
        <Campo
          label="Idade"
          icon={<Cake className="w-3.5 h-3.5" />}
          value={bio.idade}
          suffix="anos"
          editing={editing}
          draft={draft.idade}
          onDraft={(v) => setDraft({ ...draft, idade: v })}
          step={1}
        />
        <SexoCampo
          value={bio.sexo}
          editing={editing}
          draft={draft.sexo}
          onDraft={(v) => setDraft({ ...draft, sexo: v })}
        />
      </div>

      {editing && (
        <div className="mt-5 flex items-center gap-2 justify-end">
          {error && <p className="text-xs text-red-300 mr-auto">{error}</p>}
          <button
            type="button"
            onClick={cancel}
            disabled={saving}
            className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 rounded-md border border-white/[0.06]"
          >
            <X className="w-3.5 h-3.5 inline mr-1" />
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="px-3 py-1.5 text-xs text-rose-200 bg-rose-500/20 border border-rose-500/30 hover:bg-rose-500/30 rounded-md disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5 inline mr-1" />
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      )}
    </div>
  );
}

function Campo({
  label,
  icon,
  value,
  suffix,
  editing,
  draft,
  onDraft,
  step,
}: {
  label: string;
  icon: React.ReactNode;
  value: number | null;
  suffix: string;
  editing: boolean;
  draft: number | null;
  onDraft: (v: number | null) => void;
  step: number;
}) {
  return (
    <div>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide flex items-center gap-1 mb-1">
        {icon}
        {label}
      </p>
      {editing ? (
        <div className="flex items-baseline gap-1">
          <input
            type="number"
            value={draft ?? ''}
            onChange={(e) =>
              onDraft(e.target.value === '' ? null : Number(e.target.value))
            }
            step={step}
            className="w-full bg-white/[0.04] border border-white/[0.06] rounded px-2 py-1.5 text-sm num-tabular focus:outline-none focus:border-rose-400/40"
          />
          <span className="text-[11px] text-zinc-500 shrink-0">{suffix}</span>
        </div>
      ) : (
        <p className="text-lg font-semibold num-tabular text-zinc-100">
          {value != null ? value : '—'}
          <span className="text-xs font-normal text-zinc-500 ml-1">{suffix}</span>
        </p>
      )}
    </div>
  );
}

function SexoCampo({
  value,
  editing,
  draft,
  onDraft,
}: {
  value: 'M' | 'F' | null;
  editing: boolean;
  draft: 'M' | 'F' | null;
  onDraft: (v: 'M' | 'F' | null) => void;
}) {
  return (
    <div>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide flex items-center gap-1 mb-1">
        <UserRound className="w-3.5 h-3.5" />
        Sexo
      </p>
      {editing ? (
        <div className="flex gap-1">
          {(['M', 'F'] as const).map((op) => (
            <button
              key={op}
              type="button"
              onClick={() => onDraft(op)}
              className={`flex-1 px-2 py-1.5 text-xs rounded border transition-colors ${
                draft === op
                  ? 'bg-rose-500/20 border-rose-500/40 text-rose-200'
                  : 'bg-white/[0.04] border-white/[0.06] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {op === 'M' ? 'Masculino' : 'Feminino'}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-lg font-semibold text-zinc-100">
          {value === 'M' ? 'Masculino' : value === 'F' ? 'Feminino' : '—'}
        </p>
      )}
    </div>
  );
}

function msgFromCode(code: string | undefined): string {
  switch (code) {
    case 'altura_invalida':
      return 'Altura precisa estar entre 100 e 250 cm';
    case 'peso_invalido':
      return 'Peso precisa estar entre 30 e 300 kg';
    case 'idade_invalida':
      return 'Idade precisa estar entre 10 e 120 anos';
    case 'sexo_invalido':
      return 'Sexo inválido';
    case 'save_failed':
      return 'Falha ao salvar — tente de novo';
    default:
      return 'Erro ao salvar';
  }
}
