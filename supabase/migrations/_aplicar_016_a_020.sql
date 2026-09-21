-- ============================================================================
-- PACOTE CONSOLIDADO: migrations 016 → 020
-- Aplicar UMA VEZ no SQL Editor do Supabase (projeto do painel-np)
--
-- POR QUE: 4 migrations dependentes que provavelmente NÃO foram aplicadas
-- em prod (criadas em working tree mas sem deploy de DB). Cobrem:
--   - 016 (messages): persiste áudios do WhatsApp com transcrição + sumário IA
--   - 018 (alimentação): tabela refeicoes + bucket food-photos + bio em profiles
--   - 019 (renda-passiva): tabela depositos_renda_passiva
--   - 020 (reserva-emergencia): tabela depositos_reserva_emergencia
--
-- ORDEM importa: 018 tem FK pra messages.id (vinda de 016).
-- 019 e 020 são independentes entre si e de 016/018.
--
-- COMO APLICAR:
--   1. https://supabase.com/dashboard/project/<seu-projeto>/sql/new
--   2. Cola tudo abaixo
--   3. Run
--   4. O NOTIFY pgrst no final cuida do reload do schema cache do PostgREST
-- ============================================================================

-- =========================================================================
-- 016: messages (memória de mensagens do WhatsApp)
-- =========================================================================
-- Migration 016: memória de mensagens do WhatsApp (#overhaul audio)
--
-- Persiste o áudio (Storage), a transcrição crua (Whisper), e o
-- sumário por IA (Groq llama-3.1-8b-instant) pra que o user possa:
--   1. Rever o que disse em áudio dias atrás (busca textual PT-BR)
--   2. Ouvir de novo o áudio (signed URL 24h)
--   3. Ver sumário/tópicos gerados por IA
--
-- Schema monolítico com `type ENUM` (vs duas tabelas 1:1) porque:
--   - 1 INSERT em vez de 2 com transação
--   - FTS fica numa coluna só
--   - Tipos diferentes de mídia têm metadados diferentes (nullable)

create type if not exists public.message_type as enum (
  'audio',
  'image',
  'text',
  'document',
  'video'
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  module_id text not null references public.modules(id) default 'financeiro',

  -- WhatsApp
  remote_jid text not null,
  message_id_whatsapp text not null,
  from_me boolean not null default false,
  instance_name text,

  -- Tipo + payload discriminante
  type public.message_type not null,
  text text,

  -- Storage (audio, image, document, video — nullable pra text)
  storage_bucket text,
  storage_path text,
  mime_type text,
  duration_seconds int,
  size_bytes bigint,

  -- Transcrição (áudio)
  transcription text,
  transcription_language text,
  transcription_confidence numeric(4, 3),

  -- Sumário IA
  ai_summary text,
  ai_topics text[],
  ai_entities jsonb,

  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Idempotência contra reentrega da Evolution API
  unique (user_id, message_id_whatsapp)
);

create index if not exists messages_user_received_idx
  on public.messages (user_id, received_at desc);
create index if not exists messages_user_type_idx
  on public.messages (user_id, type);
create index if not exists messages_storage_path_idx
  on public.messages (storage_path)
  where storage_path is not null;

-- FTS PT-BR em transcrição + sumário
create index if not exists messages_fts_idx
  on public.messages
  using gin (to_tsvector('portuguese', coalesce(transcription, '') || ' ' || coalesce(ai_summary, '')));

alter table public.messages enable row level security;

drop policy if exists "messages_select_own" on public.messages;
create policy "messages_select_own"
  on public.messages for select
  using (auth.uid() = user_id);

drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own"
  on public.messages for insert
  with check (auth.uid() = user_id);

drop policy if exists "messages_update_own" on public.messages;
create policy "messages_update_own"
  on public.messages for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "messages_delete_own" on public.messages;
create policy "messages_delete_own"
  on public.messages for delete
  using (auth.uid() = user_id);

-- Bucket privado `audios` pra armazenar arquivos
insert into storage.buckets (id, name, public)
values ('audios', 'audios', false)
on conflict (id) do nothing;

-- =========================================================================
-- 018: alimentação + bio em profiles
-- =========================================================================
-- Migration 018: Alimentação via foto (#feature)
--
-- Reconhecimento de comida por foto do WhatsApp. Pipeline:
--   foto (60d storage) → Gemini 2.5 Flash Lite → macros estruturados → display no painel.
--
-- Decisões:
--   - Tabela nova `refeicoes` (FK messages.id 1:1) em vez de estender messages.
--     `messages` é log genérico de mídia; macros é domínio de nutrição.
--   - `correcoes_alimentos` é append-only ledger: refeição original nunca é destruída,
--     só marcada como substituída quando user ajusta via follow-up textual.
--   - `metas_nutricao` separada de `user_settings` pra não acoplar financeiro com saúde.
--   - `alimentos_tbca` é lookup table da TBCA/USP (~600 alimentos BR).
--   - `profiles` ganha altura/peso/idade/sexo (Harris-Benedict → TMB → distribuição de macros).

-- 1. Bucket `food-photos` privado
insert into storage.buckets (id, name, public)
values ('food-photos', 'food-photos', false)
on conflict (id) do nothing;

-- 2. Tabela `refeicoes`
create table if not exists public.refeicoes (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  kcal numeric(7, 2),
  protein_g numeric(6, 2),
  carb_g numeric(6, 2),
  fat_g numeric(6, 2),
  portion_g numeric(6, 2),

  -- Itens detectados (array de {nome, gramas, kcal, confianca})
  itens jsonb not null default '[]',

  -- Foto original (storage path + signed URL é gerada no GET)
  photo_storage_path text,
  photo_mime text,
  photo_taken_at timestamptz,

  -- Tipo de refeição (café/almoço/jantar/lanche)
  meal_type text,
  descricao_user text,

  -- Contexto
  confidence numeric(4, 3),
  processing_time_ms int,
  ia_model text,

  -- Append-only ledger: se user corrige, marca substituída (não deleta)
  substituida_por uuid references public.refeicoes(id),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists refeicoes_user_occurred_idx
  on public.refeicoes (user_id, occurred_at desc);
create index if not exists refeicoes_message_idx
  on public.refeicoes (message_id);
create index if not exists refeicoes_user_meal_type_idx
  on public.refeicoes (user_id, meal_type, occurred_at desc);

alter table public.refeicoes enable row level security;

drop policy if exists "refeicoes_select_own" on public.refeicoes;
create policy "refeicoes_select_own" on public.refeicoes
  for select using (auth.uid() = user_id);

drop policy if exists "refeicoes_insert_own" on public.refeicoes;
create policy "refeicoes_insert_own" on public.refeicoes
  for insert with check (auth.uid() = user_id);

drop policy if exists "refeicoes_update_own" on public.refeicoes;
create policy "refeicoes_update_own" on public.refeicoes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "refeicoes_delete_own" on public.refeicoes;
create policy "refeicoes_delete_own" on public.refeicoes
  for delete using (auth.uid() = user_id);

drop trigger if exists refeicoes_touch on public.refeicoes;
create trigger refeicoes_touch before update on public.refeicoes
  for each row execute function public.touch_updated_at();

-- 3. Tabela `correcoes_alimentos` (append-only ledger de ajustes)
create table if not exists public.correcoes_alimentos (
  id uuid primary key default gen_random_uuid(),
  refeicao_id uuid not null references public.refeicoes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  mensagem_original text,
  itens_anteriores jsonb not null,
  itens_corrigidos jsonb not null,
  kcal_anterior numeric(7, 2),
  kcal_corrigido numeric(7, 2),

  created_at timestamptz not null default now()
);

create index if not exists correcoes_alimentos_refeicao_idx
  on public.correcoes_alimentos (refeicao_id, created_at);

alter table public.correcoes_alimentos enable row level security;
drop policy if exists "correcoes_select_own" on public.correcoes_alimentos;
create policy "correcoes_select_own" on public.correcoes_alimentos
  for select using (auth.uid() = user_id);
drop policy if exists "correcoes_insert_own" on public.correcoes_alimentos;
create policy "correcoes_insert_own" on public.correcoes_alimentos
  for insert with check (auth.uid() = user_id);

-- 4. `metas_nutricao` (1 por user — cardeal mas domínio separado de user_settings)
create table if not exists public.metas_nutricao (
  user_id uuid primary key references auth.users(id) on delete cascade,
  meta_kcal numeric(7, 2),
  meta_protein_g numeric(6, 2),
  meta_carb_g numeric(6, 2),
  meta_fat_g numeric(6, 2),
  origem text not null default 'manual'
    check (origem in ('auto', 'manual', 'hibrido')),
  updated_at timestamptz default now()
);

alter table public.metas_nutricao enable row level security;
drop policy if exists "metas_nutricao_select_own" on public.metas_nutricao;
create policy "metas_nutricao_select_own" on public.metas_nutricao
  for select using (auth.uid() = user_id);
drop policy if exists "metas_nutricao_upsert_own" on public.metas_nutricao;
create policy "metas_nutricao_upsert_own" on public.metas_nutricao
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 5. `alimentos_tbca` (lookup table — read-only pra todos)
create table if not exists public.alimentos_tbca (
  id serial primary key,
  nome text not null,
  categoria text,
  kcal_per_100g numeric(6, 2),
  protein_g_per_100g numeric(6, 2),
  carb_g_per_100g numeric(6, 2),
  fat_g_per_100g numeric(6, 2),
  source text default 'TBCA/USP',
  unique (nome)
);

create index if not exists alimentos_tbca_nome_idx
  on public.alimentos_tbca using gin (nome gin_trgm_ops);
alter table public.alimentos_tbca enable row level security;
drop policy if exists "alimentos_tbca_read_all" on public.alimentos_tbca;
create policy "alimentos_tbca_read_all" on public.alimentos_tbca
  for select using (true);

-- 6. `profiles` ganha altura/peso/idade/sexo (Harris-Benedict)
alter table public.profiles
  add column if not exists altura_cm numeric(5, 2),
  add column if not exists peso_kg numeric(5, 2),
  add column if not exists idade int,
  add column if not exists sexo text check (sexo in ('M', 'F'));

-- =========================================================================
-- 019: depositos_renda_passiva
-- =========================================================================
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
-- 020: depositos_reserva_emergencia
-- =========================================================================
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

-- =========================================================================
-- IMPORTANTE: reload do schema cache do PostgREST após DDL
-- =========================================================================
NOTIFY pgrst, 'reload schema';
