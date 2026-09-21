-- 019_renda_passiva.sql
-- (#feature renda-passiva)
-- Tabela append-only de depósitos do user na jornada de renda passiva.
-- A barra de progresso da UI mostra (soma dos depósitos / capital_necessário_do_cenario).
-- Diferente de `records` (que é gasto/receita do dia-a-dia) — aqui é "guardar pra investir".

create table if not exists public.depositos_renda_passiva (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cenario text not null check (cenario in ('conservador', 'moderado', 'agressivo', 'cripto', 'independente')),
  valor numeric(12, 2) not null check (valor > 0),
  descricao text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_depositos_renda_passiva_user_occurred
  on public.depositos_renda_passiva (user_id, occurred_at desc);

-- RLS: user só vê/altera os próprios
alter table public.depositos_renda_passiva enable row level security;

drop policy if exists "depositos_rp_select_own" on public.depositos_renda_passiva;
create policy "depositos_rp_select_own"
  on public.depositos_renda_passiva for select
  using (auth.uid() = user_id);

drop policy if exists "depositos_rp_insert_own" on public.depositos_renda_passiva;
create policy "depositos_rp_insert_own"
  on public.depositos_renda_passiva for insert
  with check (auth.uid() = user_id);

drop policy if exists "depositos_rp_delete_own" on public.depositos_renda_passiva;
create policy "depositos_rp_delete_own"
  on public.depositos_renda_passiva for delete
  using (auth.uid() = user_id);
