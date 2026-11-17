-- 021_investimentos_categoria.sql
-- Investimentos por categoria: reserva | imobiliario | acoes.
-- Substitui depositos_reserva_emergencia (020) + depositos_renda_passiva (019)
-- por um ledger único. Projeções/cenários saíram do produto.
-- Migração de dados: reserva de emergência → 'reserva', renda passiva → 'acoes'.
-- As tabelas antigas ficam como legado (pode dropar depois).

do $$ begin
  create type public.investimento_categoria as enum ('reserva', 'imobiliario', 'acoes');
exception when duplicate_object then null;
end $$;

create table if not exists public.depositos_investimento (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  categoria public.investimento_categoria not null,
  valor numeric(12, 2) not null check (valor > 0),
  descricao text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_depositos_investimento_user_occurred
  on public.depositos_investimento (user_id, occurred_at desc);

alter table public.depositos_investimento enable row level security;

drop policy if exists "depositos_inv_select_own" on public.depositos_investimento;
create policy "depositos_inv_select_own"
  on public.depositos_investimento for select
  using (auth.uid() = user_id);

drop policy if exists "depositos_inv_insert_own" on public.depositos_investimento;
create policy "depositos_inv_insert_own"
  on public.depositos_investimento for insert
  with check (auth.uid() = user_id);

drop policy if exists "depositos_inv_delete_own" on public.depositos_investimento;
create policy "depositos_inv_delete_own"
  on public.depositos_investimento for delete
  using (auth.uid() = user_id);

-- Migra os depósitos dos ledgers antigos (idempotente: só se a nova
-- tabela estiver vazia — roda tudo no mesmo bloco).
do $$
begin
  if not exists (select 1 from public.depositos_investimento) then
    insert into public.depositos_investimento (user_id, categoria, valor, descricao, occurred_at, created_at)
    select user_id, 'reserva', valor, descricao, occurred_at, created_at
    from public.depositos_reserva_emergencia;

    insert into public.depositos_investimento (user_id, categoria, valor, descricao, occurred_at, created_at)
    select user_id, 'acoes', valor, descricao, occurred_at, created_at
    from public.depositos_renda_passiva;
  end if;
end $$;
