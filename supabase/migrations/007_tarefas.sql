-- =========================================================================
-- Migration 007: módulo Tarefas + agendamento de lembretes (cron WhatsApp).
-- =========================================================================

-- Catálogo de módulos: garantir 'tarefas' (idempotente)
insert into public.modules (id, label, description, icon) values
  ('tarefas', 'Tarefas', 'Lembretes, prazos, compromissos com horário.', 'ListTodo')
on conflict (id) do nothing;

-- Enum types
do $$ begin
  create type public.task_type as enum ('compromisso', 'prazo');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_priority as enum ('baixa', 'media', 'alta');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_status as enum ('pendente', 'concluida', 'cancelada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.reminder_canal as enum ('whatsapp');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.reminder_motivo as enum (
    'aviso_previo',          -- 1 dia antes (compromisso) / 2 dias antes (prazo)
    'aviso_imediato',        -- 1h15 antes (compromisso) / manhã do dia (prazo)
    'atraso_diario'          -- todo dia 9h até concluir ou 5 dias
  );
exception when duplicate_object then null; end $$;

-- =========================================================================
-- TAREFAS
-- =========================================================================
create table public.tarefas (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  module_id text not null references public.modules(id) default 'tarefas',
  texto_original text not null,                       -- 'reunião com cliente amanhã às 14h'
  titulo text not null,                               -- 'Reunião com cliente'
  descricao text,                                     -- detalhe opcional
  data_prazo date not null,                           -- sempre obrigatório
  hora_prazo time,                                    -- null = é prazo; preenchido = compromisso
  tipo public.task_type not null,                     -- coerente com hora_prazo (CHECK abaixo)
  categoria text,                                     -- 'trabalho', 'pessoal', ... (string livre)
  prioridade public.task_priority not null default 'media',
  status public.task_status not null default 'pendente',
  recorrencia text check (recorrencia in ('semanal', 'mensal')),  -- null = sem recorrência
  source public.record_source not null default 'manual',
  source_message_id text,                             -- id da msg WhatsApp (idempotência)
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  concluida_em timestamptz,
  constraint tarefas_hora_prazo_match_tipo
    check ((hora_prazo is null and tipo = 'prazo')
        or (hora_prazo is not null and tipo = 'compromisso'))
);

-- Índices
create index tarefas_user_pendentes_idx
  on public.tarefas (user_id, status, data_prazo)
  where status = 'pendente';
create index tarefas_user_data_idx
  on public.tarefas (user_id, data_prazo);
create index tarefas_user_categoria_idx
  on public.tarefas (user_id, categoria)
  where categoria is not null;

-- Idempotência (webhook WhatsApp)
create unique index tarefas_idempotency_idx
  on public.tarefas (user_id, source, source_message_id)
  where source_message_id is not null;

-- Trigger updated_at
drop trigger if exists tarefas_touch on public.tarefas;
create trigger tarefas_touch before update on public.tarefas
  for each row execute function public.touch_updated_at();

-- RLS
alter table public.tarefas enable row level security;
create policy "user full access own tarefas" on public.tarefas
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =========================================================================
-- LEMBRETES AGENDADOS
-- =========================================================================
create table public.lembretes_agendados (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tarefa_id uuid not null references public.tarefas(id) on delete cascade,
  canal public.reminder_canal not null default 'whatsapp',
  motivo public.reminder_motivo not null,
  disparar_em timestamptz not null,
  disparado_em timestamptz,
  cancelado_em timestamptz,
  erro text,
  tentativas int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Índice parcial pra cron eficiente
create index lembretes_pendentes_idx
  on public.lembretes_agendados (disparar_em)
  where disparado_em is null and cancelado_em is null;

create index lembretes_tarefa_idx
  on public.lembretes_agendados (tarefa_id);

-- RLS
alter table public.lembretes_agendados enable row level security;
create policy "user sees own lembretes" on public.lembretes_agendados
  for select using (auth.uid() = user_id);
create policy "user full access own lembretes" on public.lembretes_agendados
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists lembretes_touch on public.lembretes_agendados;
create trigger lembretes_touch before update on public.lembretes_agendados
  for each row execute function public.touch_updated_at();
