'use client';

/**
 * Drawer/modal de edição de lançamento — mobile-first.
 *
 * No mobile: bottom-sheet com altura até 90vh, botão "Salvar" sticky
 * no rodapé (pb-safe pra iOS), valor em text-2xl, inputMode decimal.
 * No desktop: modal centralizado (sm:max-w-md).
 *
 * Substitui o `EditLancamentoModal` inline que existia em
 * `app/(app)/financeiro/lancamentos/page.tsx`. Usa o `Modal` global
 * (que já tem bottom-sheet nativo) e campos otimizados pra polegar.
 */

import { useEffect, useState, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Category, FinanceRecord } from '@/lib/types';
import { Modal } from '@/components/ui/modal';
import { formatBRL } from '@/lib/utils';

const PAYMENT_METHODS = [
  { value: 'pix', label: 'PIX' },
  { value: 'cartao_credito', label: 'Crédito' },
  { value: 'cartao_debito', label: 'Débito' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'transferencia', label: 'Transf.' },
];

export function EditLancamentoDrawer({
  record,
  onClose,
  onSaved,
}: {
  record: FinanceRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [type, setType] = useState<'gasto' | 'receita'>('gasto');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement | null>(null);

  // Carrega categorias uma vez
  useEffect(() => {
    createClient()
      .from('categories')
      .select('*')
      .eq('module_id', 'financeiro')
      .order('is_system', { ascending: false })
      .order('label')
      .then(({ data }) => setCategories((data ?? []) as Category[]));
  }, []);

  // Preenche com dados do record ao abrir
  useEffect(() => {
    if (!record) return;
    setType(record.type === 'receita' ? 'receita' : 'gasto');
    setAmount(String(record.amount));
    setCategory(record.category ?? '');
    setDescription(record.description ?? '');
    setPaymentMethod(record.payment_method ?? '');
    setOccurredAt(record.occurred_at);
    setError(null);

    // Auto-foca no valor após 300ms (tempo do iOS abrir teclado não piscar)
    const t = setTimeout(() => amountRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, [record]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!record) return;
    setSaving(true);
    setError(null);

    const valor = parseFloat(amount.replace(',', '.'));
    if (Number.isNaN(valor) || valor <= 0) {
      setError('Valor inválido.');
      setSaving(false);
      return;
    }

    const res = await fetch(`/api/financeiro/lancamentos/${record.id}`, {
      method: 'PATCH',
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

    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? 'Erro ao salvar');
      return;
    }

    onSaved();
    onClose();
  }

  return (
    <Modal
      open={!!record}
      onClose={onClose}
      title={record ? `Editar ${formatBRL(Number(record.amount))}` : ''}
      size="md"
    >
      {record && (
        <form
          onSubmit={handleSubmit}
          className="space-y-3 max-h-[80vh] sm:max-h-none overflow-y-auto"
        >
          {/* Tipo — pills grandes touch-friendly */}
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

          {/* Valor — destaque, inputMode decimal pra teclado numérico */}
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

          {/* Forma de pagamento — chips horizontais (mobile-first) */}
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

          {/* Sticky bottom no mobile (dentro do Modal, fica no fim do scroll) */}
          <div className="flex gap-2 pt-2 pb-2 sticky bottom-0 bg-bg-elevated/95 backdrop-blur-sm -mx-5 sm:-mx-6 px-5 sm:px-6 border-t border-border sm:border-0">
            <button
              type="submit"
              disabled={saving}
              className="btn-primary flex-1 h-12 text-base"
            >
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
            <button type="button" onClick={onClose} className="btn-ghost h-12">
              Cancelar
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
