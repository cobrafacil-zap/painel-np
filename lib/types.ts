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

// =========================================================================
// TAREFAS (módulo Tarefas — migration 007)
// =========================================================================

export type TaskType = 'compromisso' | 'prazo';
export type TaskPriority = 'baixa' | 'media' | 'alta';
export type TaskStatus = 'pendente' | 'concluida' | 'cancelada';

export interface Tarefa {
  id: string;
  user_id: string;
  module_id: string;
  texto_original: string;
  titulo: string;
  descricao: string | null;
  data_prazo: string; // ISO date YYYY-MM-DD
  hora_prazo: string | null; // 'HH:MM:SS' ou null (prazo = sem hora)
  tipo: TaskType;
  categoria: string | null;
  prioridade: TaskPriority;
  status: TaskStatus;
  recorrencia: 'semanal' | 'mensal' | null;
  source: RecordSource;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
  concluida_em: string | null;
  confirm_message_id: string | null;
}

export type ReminderCanal = 'whatsapp';
export type ReminderMotivo = 'aviso_previo' | 'aviso_imediato' | 'atraso_diario';

export interface LembreteAgendado {
  id: string;
  user_id: string;
  tarefa_id: string;
  canal: ReminderCanal;
  motivo: ReminderMotivo;
  disparar_em: string;
  disparado_em: string | null;
  cancelado_em: string | null;
  erro: string | null;
  tentativas: number;
  created_at: string;
  updated_at: string;
}
