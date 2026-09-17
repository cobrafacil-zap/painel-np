-- =========================================================================
-- Migration 004: parcelamento de compromissos
-- Um compromisso pode ter N parcelas (ex: 800 em 4x de 200).
-- =========================================================================

alter table public.compromissos
  add column if not exists total_parcelas int default 1,
  add column if not exists parcela_atual int default 1,
  add column if not exists recorrencia text default 'mensal'
    check (recorrencia in ('unica', 'semanal', 'mensal', 'anual'));

-- Tabela de parcelas individuais (uma linha por vencimento)
create table if not exists public.compromisso_parcelas (
  id uuid primary key default uuid_generate_v4(),
  compromisso_id uuid not null references public.compromissos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  numero int not null,                                      -- 1, 2, 3, ...
  valor numeric(12, 2) not null,
  data_vencimento date not null,
  pago boolean not null default false,
  pago_em timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (compromisso_id, numero)
);

create index compromisso_parcelas_pendentes
  on public.compromisso_parcelas (user_id, pago, data_vencimento)
  where pago = false;
create index compromisso_parcelas_compromisso
  on public.compromisso_parcelas (compromisso_id, numero);

alter table public.compromisso_parcelas enable row level security;
create policy "user full access own parcelas" on public.compromisso_parcelas
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists compromisso_parcelas_touch on public.compromisso_parcelas;
create trigger compromisso_parcelas_touch before update on public.compromisso_parcelas
  for each row execute function public.touch_updated_at();

-- Atualiza o schema.sql para novas instalações
-- (a migration é adicionada abaixo no append automático)
