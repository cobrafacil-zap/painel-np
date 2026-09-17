/**
 * Tipos globais do PAINEL NP.
 * Obs: o nome `Record` colide com o tipo utilitário do TS (`Record<K, V>`),
 * então usamos `FinanceRecord` para o nosso modelo.
 */

export type RecordType = 'gasto' | 'receita' | 'neutro';
export type RecordSource = 'manual' | 'whatsapp' | 'importacao';

export interface FinanceRecord {
  id: string;
  user_id: string;
  module_id: string;
  type: RecordType;
  amount: number;
  category: string | null;
  description: string | null;
  payment_method: string | null;
  occurred_at: string; // ISO date YYYY-MM-DD
  metadata: Record<string, unknown>;
  source: RecordSource;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  user_id: string;
  module_id: string;
  slug: string;
  label: string;
  icon: string | null;
  color: string | null;
  is_system: boolean;
  created_at: string;
}

export interface Budget {
  id: string;
  user_id: string;
  category_slug: string;
  period: string; // 'YYYY-MM'
  amount: number;
  created_at: string;
  updated_at: string;
}

export interface Module {
  id: string;
  label: string;
  description: string | null;
  icon: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Compromisso {
  id: string;
  user_id: string;
  module_id: string;
  tipo: 'pagar' | 'receber';
  descricao: string;
  valor_total: number;
  valor_pago: number;
  data_vencimento: string | null; // ISO date YYYY-MM-DD ou null
  pago: boolean;
  pago_em: string | null;
  observacoes: string | null;
  source: RecordSource;
  source_message_id: string | null;
  total_parcelas: number;
  parcela_atual: number;
  recorrencia: 'unica' | 'semanal' | 'mensal' | 'anual';
  created_at: string;
  updated_at: string;
}

export interface CompromissoParcela {
  id: string;
  compromisso_id: string;
  user_id: string;
  numero: number;
  valor: number;
  data_vencimento: string; // ISO date
  pago: boolean;
  pago_em: string | null;
  created_at: string;
  updated_at: string;
}
