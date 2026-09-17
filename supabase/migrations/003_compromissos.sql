-- =========================================================================
-- Migration 003: tabela compromissos (contas a pagar/receber, lembretes)
-- =========================================================================

create table public.compromissos (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  module_id text not null references public.modules(id) default 'financeiro',
  tipo text not null check (tipo in ('pagar', 'receber')),  -- 'pagar' = eu devo; 'receber' = me devem
  descricao text not null,                                  -- 'Empréstimo da mãe', 'Fatura do cartão'
  valor_total numeric(12, 2) not null,                       -- valor original
  valor_pago numeric(12, 2) not null default 0,              -- quanto já foi pago/recebido
  data_vencimento date,                                     -- prazo final (pode ser null = sem prazo)
  pago boolean not null default false,                       -- quitado?
  pago_em timestamptz,
  observacoes text,
  source public.record_source not null default 'manual',
  source_message_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index compromissos_user_pendentes on public.compromissos (user_id, pago, data_vencimento)
  where pago = false;
create index compromissos_user_tipo on public.compromissos (user_id, tipo);

-- Idempotência (webhook WhatsApp)
create unique index compromissos_idempotency_idx
  on public.compromissos (user_id, source, source_message_id)
  where source_message_id is not null;

alter table public.compromissos enable row level security;
create policy "user full access own compromissos" on public.compromissos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists compromissos_touch on public.compromissos;
create trigger compromissos_touch before update on public.compromissos
  for each row execute function public.touch_updated_at();
