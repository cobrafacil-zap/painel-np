-- =========================================================================
-- PAINEL NP — Schema base multi-módulo
-- Rode este arquivo no SQL Editor do Supabase (projeto novo).
-- =========================================================================

-- Extensões úteis
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- =========================================================================
-- AUTH: aproveita auth.users do Supabase nativo
-- =========================================================================

-- Tabela de profile (espelha auth.users, com dados extras)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  whatsapp_number text unique,            -- "53981113358" (legado / opcional)
  whatsapp_group_jid text,                -- '120363...@g.us' (grupo dedicado do painel)
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint profiles_group_jid_format check (whatsapp_group_jid is null or whatsapp_group_jid like '%@g.us')
);

alter table public.profiles enable row level security;
create policy "user sees own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "user updates own profile" on public.profiles
  for update using (auth.uid() = id);

-- Trigger: cria profile automaticamente quando um user é criado
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================================
-- MÓDULOS: catálogo (extensível, sem migração pesada para novos módulos)
-- =========================================================================

create table public.modules (
  id text primary key,                    -- 'financeiro', 'treino', 'saude'
  label text not null,                    -- 'Financeiro', 'Treino', 'Saúde'
  description text,
  icon text,                              -- nome do ícone Lucide
  is_active boolean default true,
  created_at timestamptz default now()
);

insert into public.modules (id, label, description, icon) values
  ('financeiro', 'Financeiro', 'Lançamentos, orçamento, gráficos.', 'Wallet'),
  ('treino',     'Treino',     'Registros de treino, cargas, evolução.', 'Dumbbell'),
  ('saude',      'Saúde',      'Sono, hidratação, peso.', 'HeartPulse')
on conflict (id) do nothing;

alter table public.modules enable row level security;
create policy "modules read all authenticated" on public.modules
  for select using (auth.role() = 'authenticated');

-- =========================================================================
-- RECORDS: tabela genérica para entradas de qualquer módulo
-- =========================================================================

do $$ begin
  create type public.record_type as enum ('gasto', 'receita', 'neutro');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.record_source as enum ('manual', 'whatsapp', 'importacao');
exception when duplicate_object then null; end $$;

create table public.records (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  module_id text not null references public.modules(id),
  type public.record_type not null,
  amount numeric(12, 2) not null,        -- sempre positivo; type define sinal
  category text,                          -- string livre p/ MVP (FK opcional depois)
  description text,
  payment_method text,                    -- 'pix', 'cartao_credito', 'dinheiro', etc.
  occurred_at date not null default current_date,
  metadata jsonb default '{}'::jsonb,     -- extensível
  source public.record_source not null default 'manual',
  source_message_id text,                 -- ID da mensagem WhatsApp (idempotência)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Idempotência: se a Evolution reentregar a mesma msg, não duplica
create unique index records_idempotency_idx
  on public.records (user_id, source, source_message_id)
  where source_message_id is not null;

create index records_user_module_date on public.records (user_id, module_id, occurred_at desc);
create index records_user_category on public.records (user_id, category);

alter table public.records enable row level security;
create policy "user full access own records" on public.records
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Trigger updated_at
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists records_touch on public.records;
create trigger records_touch before update on public.records
  for each row execute function public.touch_updated_at();

-- =========================================================================
-- FINANCEIRO: tabelas específicas (categorias custom, orçamento)
-- =========================================================================

create table public.categories (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  module_id text not null references public.modules(id),
  slug text not null,                     -- 'mercado', 'transporte', 'freelance'
  label text not null,                    -- 'Mercado', 'Transporte', 'Freelance'
  icon text,
  color text,
  is_system boolean default false,        -- pré-definidas (não deletáveis)
  created_at timestamptz default now(),
  unique (user_id, module_id, slug)
);

alter table public.categories enable row level security;
create policy "user full access own categories" on public.categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.budgets (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_slug text not null,            -- ref por slug (não FK, p/ permitir deletar categoria)
  period text not null,                   -- '2026-09' (YYYY-MM)
  amount numeric(12, 2) not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, category_slug, period)
);

alter table public.budgets enable row level security;
create policy "user full access own budgets" on public.budgets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists budgets_touch on public.budgets;
create trigger budgets_touch before update on public.budgets
  for each row execute function public.touch_updated_at();

-- =========================================================================
-- Categorias pré-definidas (seed para cada user novo)
-- =========================================================================

create or replace function public.seed_default_categories(p_user_id uuid)
returns void language plpgsql security definer as $$
begin
  insert into public.categories (user_id, module_id, slug, label, icon, color, is_system)
  values
    (p_user_id, 'financeiro', 'mercado',       'Mercado',       'ShoppingCart',  '#10b981', true),
    (p_user_id, 'financeiro', 'transporte',    'Transporte',    'Car',           '#3b82f6', true),
    (p_user_id, 'financeiro', 'alimentacao',   'Alimentação',   'Utensils',      '#f59e0b', true),
    (p_user_id, 'financeiro', 'moradia',       'Moradia',       'Home',          '#8b5cf6', true),
    (p_user_id, 'financeiro', 'saude',         'Saúde',         'Heart',         '#ef4444', true),
    (p_user_id, 'financeiro', 'lazer',         'Lazer',         'Smile',         '#ec4899', true),
    (p_user_id, 'financeiro', 'educacao',      'Educação',      'GraduationCap', '#06b6d4', true),
    (p_user_id, 'financeiro', 'assinaturas',   'Assinaturas',   'Repeat',        '#a855f7', true),
    (p_user_id, 'financeiro', 'freelance',     'Freelance',     'Briefcase',     '#22c55e', true),
    (p_user_id, 'financeiro', 'salario',       'Salário',       'Banknote',      '#16a34a', true),
    (p_user_id, 'financeiro', 'investimentos', 'Investimentos', 'TrendingUp',    '#0ea5e9', true),
    (p_user_id, 'financeiro', 'outros',        'Outros',        'Circle',        '#6b7280', true)
  on conflict (user_id, module_id, slug) do nothing;
end $$;

-- Estende o trigger de novo user para semear categorias
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;

  perform public.seed_default_categories(new.id);

  return new;
end $$;

-- Backfill: cria categorias para users existentes que não têm
do $$
declare
  u uuid;
begin
  for u in select id from auth.users loop
    perform public.seed_default_categories(u);
  end loop;
end $$;

-- =========================================================================
-- WHATSAPP SESSIONS: rastreia contexto por número
-- =========================================================================

create table public.whatsapp_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  remote_jid text not null,               -- '5511981113358@s.whatsapp.net' ou grupo
  instance_name text not null,            -- 'painel-np'
  last_message_at timestamptz,
  context jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- Webhook roda server-side com service_role; sem policy para o user.
alter table public.whatsapp_sessions enable row level security;

-- =========================================================================
-- STORAGE: bucket para comprovantes (fotos)
-- =========================================================================
insert into storage.buckets (id, name, public) values ('comprovantes', 'comprovantes', false)
  on conflict do nothing;

create policy "user uploads own comprovantes" on storage.objects
  for insert with check (
    bucket_id = 'comprovantes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
create policy "user reads own comprovantes" on storage.objects
  for select using (
    bucket_id = 'comprovantes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
