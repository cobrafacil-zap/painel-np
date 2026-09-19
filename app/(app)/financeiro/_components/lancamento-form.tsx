'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Category } from '@/lib/types';
import { todayISO } from '@/lib/utils';
import { Plus, X } from 'lucide-react';

const PAYMENT_METHODS = [
  { value: 'pix', label: 'PIX' },
  { value: 'cartao_credito', label: 'Crédito' },
  { value: 'cartao_debito', label: 'Débito' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'transferencia', label: 'Transf.' },
];

export function LancamentoForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [type, setType] = useState<'gasto' | 'receita'>('gasto');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [occurredAt, setOccurredAt] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    createClient()
      .from('categories')
      .select('*')
      .eq('module_id', 'financeiro')
      .order('is_system', { ascending: false })
      .order('label')
      .then(({ data }) => setCategories((data ?? []) as Category[]));

    // Auto-foca no valor (delay evita piscar teclado iOS)
    const t = setTimeout(() => amountRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const valor = parseFloat(amount.replace(',', '.'));
    if (Number.isNaN(valor) || valor <= 0) {
      setError('Valor inválido.');
      setSaving(false);
      return;
    }

    const res = await fetch('/api/financeiro/lancamentos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        amount: valor,
        category: category || null,
        description: description || null,
        payment_method: paymentMethod || null,
        occurred_at: occurredAt,
      }),
    });

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? 'Erro ao salvar');
      setSaving(false);
      return;
    }

    // reset
    setAmount('');
    setDescription('');
    setCategory('');
    setPaymentMethod('');
    setOpen(false);
    setSaving(false);
    onCreated();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary inline-flex items-center gap-2">
        <Plus className="w-4 h-4" />
        Novo lançamento
      </button>
    );
  }

  return (
    // Mobile-first: bottom-sheet no mobile, card no desktop
    <div className="fixed inset-x-0 bottom-0 z-30 sm:relative sm:inset-auto sm:z-auto">
      <form
        onSubmit={handleSubmit}
        className="bg-bg-elevated rounded-t-2xl sm:rounded-2xl sm:shadow-lg border-t sm:border border-border p-5 sm:p-6 space-y-3 max-h-[90vh] overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]"
      >
        {/* Header mobile-first com X pra fechar */}
        <div className="flex items-center justify-between pb-1">
          <h2 className="text-base font-semibold">Novo lançamento</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="sm:hidden p-2 -mr-2 text-zinc-400"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tipo — pills grandes */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setType('gasto')}
            className={`flex-1 h-11 rounded-lg text-sm font-medium transition-colors ${
              type === 'gasto'
                ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                : 'bg-bg-base border border-border text-zinc-400'
            }`}
          >
            Gasto
          </button>
          <button
            type="button"
            onClick={() => setType('receita')}
            className={`flex-1 h-11 rounded-lg text-sm font-medium transition-colors ${
              type === 'receita'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-bg-base border border-border text-zinc-400'
            }`}
          >
            Receita
          </button>
        </div>

        {/* Valor — destaque, inputMode decimal + pattern pra teclado numérico iOS */}
        <div>
          <label className="text-xs uppercase tracking-wider text-zinc-500 mb-1 block">
            Valor (R$)
          </label>
          <input
            ref={amountRef}
            type="text"
            inputMode="decimal"
            pattern="[0-9]*"
            autoComplete="off"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
            className="w-full h-14 px-3 text-2xl font-semibold tabular-nums rounded-lg bg-bg-base border border-border focus:border-emerald-500 focus:outline-none"
          />
        </div>

        {/* Categoria + Data */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs uppercase tracking-wider text-zinc-500 mb-1 block">
              Categoria
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full h-11 px-2 rounded-lg bg-bg-base border border-border"
            >
              <option value="">— sem categoria —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-zinc-500 mb-1 block">
              Data
            </label>
            <input
              type="date"
              required
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className="w-full h-11 px-2 rounded-lg bg-bg-base border border-border"
            />
          </div>
        </div>

        {/* Forma de pagamento — chips horizontais scrolláveis */}
        <div>
          <label className="text-xs uppercase tracking-wider text-zinc-500 mb-1 block">
            Forma de pagamento
          </label>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setPaymentMethod(m.value === paymentMethod ? '' : m.value)}
                className={`px-3 h-9 rounded-full text-xs whitespace-nowrap transition-colors ${
                  paymentMethod === m.value
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-bg-base border border-border text-zinc-400'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Descrição */}
        <div>
          <label className="text-xs uppercase tracking-wider text-zinc-500 mb-1 block">
            Descrição
          </label>
          <input
            type="text"
            autoComplete="off"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="ex: almoço no restaurante X"
            className="w-full h-11 px-3 rounded-lg bg-bg-base border border-border"
          />
        </div>

        {error && (
          <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded p-2">
            {error}
          </p>
        )}

        {/* Botões — full-width no mobile (sticky dentro do sheet) */}
        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="btn-primary flex-1 h-12 text-base"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="btn-ghost h-12 px-4"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
