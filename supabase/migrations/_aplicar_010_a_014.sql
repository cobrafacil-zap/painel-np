-- ============================================================================
-- PACOTE CONSOLIDADO: migrations 010 → 014
-- Aplicar UMA VEZ no SQL Editor do Supabase (projeto do painel-np)
-- Todas idempotentes — pode rodar mais de uma vez sem quebrar.
-- ============================================================================

-- ---------- 010 ----------
alter table public.tarefas
  add column if not exists ordem int;

update public.tarefas
  set ordem = extract(epoch from created_at)::int
  where ordem is null;

create index if not exists idx_tarefas_user_ordem
  on public.tarefas (user_id, ordem)
  where status = 'pendente';

-- ---------- 011 ----------
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'whatsapp_sessions_pkey'
      and conrelid = 'public.whatsapp_sessions'::regclass
  ) then
    alter table public.whatsapp_sessions drop constraint whatsapp_sessions_pkey;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'whatsapp_sessions_pkey'
      and conrelid = 'public.whatsapp_sessions'::regclass
  ) then
    alter table public.whatsapp_sessions
      add constraint whatsapp_sessions_pkey primary key (user_id, remote_jid);
  end if;
end $$;

create index if not exists whatsapp_sessions_jid_idx
  on public.whatsapp_sessions (user_id, remote_jid, last_message_at desc);

-- ---------- 012 ----------
create table if not exists public.user_patterns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  pattern_key text not null,
  pattern_type text not null,
  avg_amount numeric(12,2),
  stddev_amount numeric(12,2),
  day_of_month int,
  frequency text,
  sample_count int default 0,
  last_seen_at timestamptz,
  next_expected_date date,
  next_expected_amount numeric(12,2),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, pattern_key)
);

create index if not exists user_patterns_user_idx
  on public.user_patterns (user_id);

create index if not exists user_patterns_next_expected_idx
  on public.user_patterns (user_id, next_expected_date)
  where next_expected_date is not null;

alter table public.user_patterns enable row level security;

create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists user_patterns_touch_updated_at on public.user_patterns;
create trigger user_patterns_touch_updated_at
  before update on public.user_patterns
  for each row execute function public.touch_updated_at();

-- ---------- 013 ----------
do $$ begin
  alter type public.reminder_motivo add value if not exists 'compromisso_vencido';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.reminder_motivo add value if not exists 'previsao_conta';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.reminder_motivo add value if not exists 'insight_mensal';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.reminder_motivo add value if not exists 'relatorio_diario';
exception when duplicate_object then null; end $$;

alter table public.lembretes_agendados
  add column if not exists parcela_id uuid
    references public.compromisso_parcelas(id) on delete cascade,
  add column if not exists message_text text;

alter table public.lembretes_agendados
  alter column tarefa_id drop not null;

-- ---------- 014 ----------
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  meta_diaria numeric(12, 2),
  updated_at timestamptz default now()
);

alter table public.user_settings enable row level security;
create policy "user full access own settings" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();
