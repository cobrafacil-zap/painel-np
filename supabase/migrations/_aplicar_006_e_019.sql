-- ============================================================================
-- PACOTE CONSOLIDADO: migrations 006 + 019
-- Aplicar UMA VEZ no SQL Editor do Supabase (projeto do painel-np)
--
-- POR QUE: o INSERT em `compromissos` falha com
--   "Could not find the 'category' column of 'compromissos' in the schema cache"
-- porque a migration 006 não foi aplicada. A 019 (renda passiva) também
-- precisa estar aplicada pra feature de depósito funcionar.
--
-- COMO APLICAR:
--   1. https://supabase.com/dashboard/project/<seu-projeto>/sql/new
--   2. Cola tudo abaixo
--   3. Run
--   4. Após aplicar, PostgREST às vezes precisa reload do schema cache.
--      No SQL Editor: `NOTIFY pgrst, 'reload schema';`
-- ============================================================================

-- =========================================================================
-- 006: coluna category em compromissos
-- =========================================================================
alter table public.compromissos
  add column if not exists category text;

create index if not exists compromissos_user_category_idx
  on public.compromissos (user_id, category)
  where category is not null;

-- =========================================================================
-- 019: depositos_renda_passiva (renda passiva v2)
-- =========================================================================
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

-- =========================================================================
-- IMPORTANTE: reload do schema cache do PostgREST após DDL
-- =========================================================================
NOTIFY pgrst, 'reload schema';
