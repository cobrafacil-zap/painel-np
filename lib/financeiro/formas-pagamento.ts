/**
 * Formas de pagamento ("Tipo") — lista única usada nos formulários,
 * tabelas e parser do WhatsApp.
 */

export interface FormaPagamento {
  value: string;
  label: string;
}

export const FORMAS_PAGAMENTO: FormaPagamento[] = [
  { value: 'pix', label: 'PIX' },
  { value: 'cartao_credito', label: 'Cartão de crédito' },
  { value: 'cartao_debito', label: 'Cartão de débito' },
  { value: 'crediario', label: 'Crediário' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'transferencia', label: 'Transferência' },
];

/** 'cartao_credito' → 'Cartão de crédito'. Sem valor → '—'. */
export function labelForma(value: string | null | undefined): string {
  if (!value) return '—';
  return FORMAS_PAGAMENTO.find((f) => f.value === value)?.label ?? value;
}
