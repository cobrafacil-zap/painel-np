'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Category } from '@/lib/types';
import { todayISO } from '@/lib/utils';
import { Plus } from 'lucide-react';

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

  useEffect(() => {
    if (!open) return;
    createClient()
      .from('categories')
      .select('*')
      .eq('module_id', 'financeiro')
      .order('is_system', { ascending: false })
      .order('label')
      .then(({ data }) => setCategories((data ?? []) as Category[]));
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
    <form onSubmit={handleSubmit} className="card space-y-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setType('gasto')}
          className={`flex-1 py-2 rounded-md text-sm font-medium ${type === 'gasto' ? 'bg-red-500/20 text-red-300 border border-red-500/40' : 'bg-bg-base border border-border text-zinc-400'}`}
        >
          Gasto
        </button>
        <button
          type="button"
          onClick={() => setType('receita')}
          className={`flex-1 py-2 rounded-md text-sm font-medium ${type === 'receita' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-bg-base border border-border text-zinc-400'}`}
        >
          Receita
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label>Valor (R$)</label>
          <input
            type="text"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
            className="w-full"
          />
        </div>
        <div>
          <label>Data</label>
          <input
            type="date"
            required
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            className="w-full"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label>Categoria</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full">
            <option value="">— sem categoria —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Forma de pagamento</label>
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="w-full">
            <option value="">—</option>
            <option value="pix">PIX</option>
            <option value="cartao_credito">Cartão de crédito</option>
            <option value="cartao_debito">Cartão de débito</option>
            <option value="dinheiro">Dinheiro</option>
            <option value="boleto">Boleto</option>
            <option value="transferencia">Transferência</option>
          </select>
        </div>
      </div>

      <div>
        <label>Descrição</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="ex: almoço no restaurante X"
          className="w-full"
        />
      </div>

      {error && (
        <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded p-2">{error}</p>
      )}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
          Cancelar
        </button>
      </div>
    </form>
  );
}
