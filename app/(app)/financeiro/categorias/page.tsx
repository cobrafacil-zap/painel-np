'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Trash2, Pencil, Plus, X, Check, Shield } from 'lucide-react';

type Category = {
  id: string;
  slug: string;
  label: string;
  icon: string | null;
  color: string | null;
  is_system: boolean;
};

const ICON_OPTIONS = [
  'ShoppingCart', 'Car', 'Utensils', 'Home', 'Heart', 'Smile',
  'GraduationCap', 'Repeat', 'Briefcase', 'Banknote', 'TrendingUp',
  'Fuel', 'Circle', 'Coffee', 'Plane', 'Gift', 'Music', 'BookOpen',
];

const COLOR_OPTIONS = [
  '#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#ec4899',
  '#06b6d4', '#a855f7', '#22c55e', '#16a34a', '#0ea5e9', '#f97316',
  '#6b7280', '#84cc16', '#14b8a6',
];

export default function CategoriasPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editIcon, setEditIcon] = useState<string | null>(null);
  const [editColor, setEditColor] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newSlug, setNewSlug] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newIcon, setNewIcon] = useState<string | null>('Circle');
  const [newColor, setNewColor] = useState<string | null>('#6b7280');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/financeiro/categorias')
      .then((r) => r.json())
      .then(({ categories }) => {
        setCategories((categories ?? []) as Category[]);
        setLoading(false);
      });
  }, [refreshKey]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function startEdit(c: Category) {
    setEditingId(c.id);
    setEditLabel(c.label);
    setEditIcon(c.icon);
    setEditColor(c.color);
  }

  async function saveEdit(c: Category) {
    const res = await fetch(`/api/financeiro/categorias/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: editLabel,
        icon: editIcon,
        color: editColor,
      }),
    });
    if (res.ok) {
      flash('✅ Categoria atualizada.');
      setEditingId(null);
      setRefreshKey((k) => k + 1);
    } else {
      const err = await res.json().catch(() => ({}));
      flash(`⚠️ ${err.error ?? 'Erro ao salvar'}`);
    }
  }

  async function deleteCategory(c: Category) {
    if (!confirm(`Apagar a categoria "${c.label}"?\n\nLançamentos existentes manterão o slug antigo.`)) return;
    const res = await fetch(`/api/financeiro/categorias/${c.id}`, { method: 'DELETE' });
    if (res.ok) {
      flash('🗑️ Categoria apagada.');
      setRefreshKey((k) => k + 1);
    } else {
      const err = await res.json().catch(() => ({}));
      flash(`⚠️ ${err.error ?? 'Erro ao apagar'}`);
    }
  }

  async function createCategory() {
    const slug = newSlug.trim().toLowerCase().replace(/\s+/g, '_');
    if (!newLabel.trim() || !slug) {
      flash('⚠️ Slug e label são obrigatórios.');
      return;
    }
    const res = await fetch('/api/financeiro/categorias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        label: newLabel.trim(),
        icon: newIcon,
        color: newColor,
      }),
    });
    if (res.ok) {
      flash('✅ Categoria criada.');
      setShowNew(false);
      setNewSlug('');
      setNewLabel('');
      setNewIcon('Circle');
      setNewColor('#6b7280');
      setRefreshKey((k) => k + 1);
    } else {
      const err = await res.json().catch(() => ({}));
      flash(`⚠️ ${err.error ?? 'Erro ao criar'}`);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Categorias</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Edite, crie ou apague categorias. As do sistema são protegidas (só dá pra renomear).
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nova categoria
        </button>
      </header>

      <div className="card p-0 overflow-hidden relative">
        {loading ? (
          <p className="p-6 text-sm text-zinc-500">Carregando…</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-bg-elevated text-zinc-400">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Cor</th>
                <th className="text-left px-4 py-2.5 font-medium">Label</th>
                <th className="text-left px-4 py-2.5 font-medium">Slug</th>
                <th className="text-left px-4 py-2.5 font-medium">Tipo</th>
                <th className="w-24"></th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id} className="border-t border-border hover:bg-bg-elevated/50">
                  <td className="px-4 py-2.5">
                    <div
                      className="w-6 h-6 rounded"
                      style={{ backgroundColor: c.color ?? '#6b7280' }}
                      title={c.color ?? ''}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    {editingId === c.id ? (
                      <input
                        type="text"
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        className="bg-bg-elevated border border-border rounded px-2 py-1 text-sm w-full"
                        autoFocus
                      />
                    ) : (
                      <span className="font-medium">{c.label}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500 font-mono text-xs">{c.slug}</td>
                  <td className="px-4 py-2.5">
                    {c.is_system ? (
                      <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                        <Shield className="w-3 h-3" /> sistema
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-500">personalizada</span>
                    )}
                  </td>
                  <td className="px-2">
                    {editingId === c.id ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => saveEdit(c)}
                          className="p-1.5 rounded hover:bg-emerald-500/10 text-emerald-300"
                          title="Salvar"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1.5 rounded hover:bg-bg-elevated text-zinc-400"
                          title="Cancelar"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <button
                          onClick={() => startEdit(c)}
                          className="p-1.5 rounded hover:bg-bg-elevated text-zinc-400 hover:text-zinc-200"
                          title="Editar"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {!c.is_system && (
                          <button
                            onClick={() => deleteCategory(c)}
                            className="p-1.5 rounded hover:bg-red-500/10 text-zinc-500 hover:text-red-300"
                            title="Apagar"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {toast && (
          <div className="absolute bottom-4 right-4 bg-bg-elevated border border-border rounded-lg px-4 py-2.5 text-sm shadow-lg">
            {toast}
          </div>
        )}
      </div>

      {/* Modal: Nova categoria */}
      {showNew && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setShowNew(false)}
        >
          <div className="card max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">Nova categoria</h3>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">Label (nome exibido)</label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Ex: Pets"
                className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">Slug (identificador, sem espaços)</label>
              <input
                type="text"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                placeholder="Ex: pets"
                className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-2">Cor</label>
              <div className="flex flex-wrap gap-2">
                {COLOR_OPTIONS.map((color) => (
                  <button
                    key={color}
                    onClick={() => setNewColor(color)}
                    className={`w-7 h-7 rounded-full border-2 transition-all ${
                      newColor === color ? 'border-white scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setShowNew(false)}
                className="px-4 py-2 rounded-lg text-sm hover:bg-bg-elevated"
              >
                Cancelar
              </button>
              <button
                onClick={createCategory}
                className="px-4 py-2 rounded-lg text-sm bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
              >
                Criar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Editar (campos extras) */}
      {editingId && (() => {
        const c = categories.find((x) => x.id === editingId);
        if (!c) return null;
        return (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setEditingId(null)}>
            <div className="card max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold">Editar &ldquo;{c.label}&rdquo;</h3>

              <div>
                <label className="block text-xs text-zinc-400 mb-2">Cor</label>
                <div className="flex flex-wrap gap-2">
                  {COLOR_OPTIONS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setEditColor(color)}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${
                        editColor === color ? 'border-white scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <button
                  onClick={() => setEditingId(null)}
                  className="px-4 py-2 rounded-lg text-sm hover:bg-bg-elevated"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => saveEdit(c)}
                  className="px-4 py-2 rounded-lg text-sm bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
