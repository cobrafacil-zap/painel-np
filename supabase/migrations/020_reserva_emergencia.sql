-- 020_reserva_emergencia.sql
-- (#feature reserva-emergencia)
-- Reserva de emergência: meta = gastos fixos mensais × 6.
-- Append-only ledger como depositos_renda_passiva (019).
-- Quando bate 100%, libera redirecionamento pra renda passiva.

create table if not exists public.depositos_reserva_emergencia (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  valor numeric(12, 2) not null check (valor > 0),
  descricao text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_depositos_reserva_user_occurred
  on public.depositos_reserva_emergencia (user_id, occurred_at desc);

alter table public.depositos_reserva_emergencia enable row level security;

drop policy if exists "depositos_re_select_own" on public.depositos_reserva_emergencia;
create policy "depositos_re_select_own"
  on public.depositos_reserva_emergencia for select
  using (auth.uid() = user_id);

drop policy if exists "depositos_re_insert_own" on public.depositos_reserva_emergencia;
create policy "depositos_re_insert_own"
  on public.depositos_reserva_emergencia for insert
  with check (auth.uid() = user_id);

drop policy if exists "depositos_re_delete_own" on public.depositos_reserva_emergencia;
create policy "depositos_re_delete_own"
  on public.depositos_reserva_emergencia for delete
  using (auth.uid() = user_id);
