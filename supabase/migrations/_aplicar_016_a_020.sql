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
-- Este arquivo é a CONCATENAÇÃO literal dos 4 arquivos individuais. Se algum
-- deles já tiver sido aplicado em prod, pular a seção correspondente.
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
-- 016_messages.sql

-- Migration 016: memória de mensagens do WhatsApp (#overhaul audio)
--
-- Persiste o áudio (Storage), a transcrição crua (Whisper), e o
-- sumário por IA (Groq llama-3.1-8b-instant) pra que o user possa:
--   1. Rever o que disse em áudio dias atrás (busca textual PT-BR)
--   2. Ouvir de novo o áudio (signed URL 24h)
--   3. Ver sumário/tópicos gerados por IA
--
-- Schema monolítico com `type ENUM` (vs duas tabelas 1:1) porque:
--   - 1 INSERT em vez de 2 com tx
--   - FTS em `transcription` direto (sem JOIN)
--   - Fácil estender pra image/document no futuro (só colunas nullable)
--
-- RLS: user vê/edita só os próprios. Bucket `audios` particionado por
-- `audios/{user_id}/...` (mesmo padrão de `comprovantes` em schema.sql:230).
--
-- Idempotência: UNIQUE (user_id, message_id_whatsapp) protege contra
-- reentregas da Evolution API. INSERT usa ON CONFLICT DO NOTHING.
--
-- Retenção: arquivo de áudio expira após 90 dias via cron
-- `app/api/cron/cleanup-audios` (0 3 * * *). Transcrição+sumário
-- ficam pra sempre (apenas `audio_storage_path` é zerado).

-- 1. Bucket de Storage privado pra áudio
insert into storage.buckets (id, name, public)
values ('audios', 'audios', false)
on conflict (id) do nothing;

-- 2. ENUM do tipo de mensagem
do $$ begin
  create type public.message_type as enum ('audio', 'image', 'text', 'document', 'video');
exception when duplicate_object then null; end $$;

-- 3. Tabela principal
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Identificador WhatsApp (idempotência contra reentregas da Evolution)
  message_id_whatsapp text not null,
  remote_jid text not null,
  instance_name text,

  -- Discriminator
  type public.message_type not null,

  -- Campos específicos de áudio (NULL pra outros tipos)
  audio_storage_path text,                          -- 'audios/{user_id}/{msg_id}.ogg'
  duration_seconds int,
  mime_type text,
  file_size_bytes bigint,

  -- Conteúdo
  transcription text,                                -- Whisper Large v3
  transcription_confidence numeric(3, 2),           -- Whisper verbose_json no_speech_prob, fallback 0.85

  -- IA pós-transcrição (Groq llama-3.1-8b-instant)
  ai_summary text,                                   -- 1-2 frases (≤200 chars)
  ai_topics text[],                                  -- 3-7 tags lowercase
  ai_entities jsonb,                                 -- {people:[], places:[], amounts:[]}

  -- Metadados livres (transcrição já guarda o conteúdo bruto)
  metadata jsonb not null default '{}'::jsonb,

  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Coluna gerada que concatena transcrição + sumário pra FTS.
  -- PostgREST `.textSearch('search_text', ...)` opera sobre uma coluna;
  -- ter uma coluna virtual evita o `.or()` e usa o índice GIN direito.
  search_text text generated always as (
    coalesce(transcription, '') || ' ' || coalesce(ai_summary, '')
  ) stored,

  -- Idempotência: 1 row por (user, whatsapp_msg_id)
  constraint messages_user_msg_unique unique (user_id, message_id_whatsapp)
);

-- 4. Índices
create index if not exists messages_user_type_occurred
  on public.messages (user_id, type, occurred_at desc);

create index if not exists messages_user_occurred
  on public.messages (user_id, occurred_at desc);

-- Full-text search em PT-BR (sem precisar de pgvector — busca por
-- palavra-chave cobre o caso de uso: "qual áudio falou sobre mercado?")
create index if not exists messages_search_text_fts
  on public.messages using gin (to_tsvector('portuguese', search_text))
  where type = 'audio';

-- 5. RLS
alter table public.messages enable row level security;

drop policy if exists "user full access own messages" on public.messages;
create policy "user full access own messages"
  on public.messages for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 6. Trigger de updated_at (função criada em migration 012)
drop trigger if exists messages_touch on public.messages;
create trigger messages_touch before update on public.messages
  for each row execute function public.touch_updated_at();

-- 7. RLS do bucket `audios` — mesmo padrão de `comprovantes`
drop policy if exists "user uploads own audios" on storage.objects;
drop policy if exists "user reads own audios" on storage.objects;
drop policy if exists "user deletes own audios" on storage.objects;

create policy "user uploads own audios" on storage.objects
  for insert with check (
    bucket_id = 'audios'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "user reads own audios" on storage.objects
  for select using (
    bucket_id = 'audios'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "user deletes own audios" on storage.objects
  for delete using (
    bucket_id = 'audios'
    and auth.uid()::text = (storage.foldername(name))[1]
  );


-- =========================================================================
-- 018: alimentação + bio em profiles
-- =========================================================================
-- 018_alimentacao.sql

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
--   - `metas_nutricao` separada de `user_settings` pra não acoplar financeiro com saúde
--     (1 user_settings vs 1 metas_nutricao = mesma cardinalidade mas domínios distintos).
--   - `alimentos_tbca` é lookup table da TBCA/USP (~600 alimentos BR).
--   - `profiles` ganha altura/peso/idade/sexo (Harris-Benedict → TMB → distribuição de macros).
--
-- Retenção:
--   - foto: 60 dias (cron `cleanupOldFoodPhotos`). Menos que áudio porque é maior em MB.
--   - macros: indefinido (não é dado pessoal identificável depois de extraído).
--
-- LGPD:
--   - Foto de comida é dado pessoal (associada ao telefone via messages.user_id).
--   - Consentimento no onboarding do WhatsApp + comando `/apagar`.

-- 1. Bucket `food-photos` privado
insert into storage.buckets (id, name, public)
values ('food-photos', 'food-photos', false)
on conflict (id) do nothing;

-- 2. Tabela `refeicoes` (1 row por foto analisada)
create table if not exists public.refeicoes (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Macros principais (todos nullable: IA pode falhar parcialmente)
  kcal numeric(7, 2),
  protein_g numeric(6, 2),
  carb_g numeric(6, 2),
  fat_g numeric(6, 2),
  portion_g numeric(6, 2),

  -- Classificação
  meal_type text check (meal_type in ('cafe', 'almoco', 'jantar', 'lanche')),
  confidence numeric(3, 2), -- 0.00 a 1.00 (Gemini retorna, usamos pra UI)
  ai_model text not null,  -- 'gemini-2.5-flash-lite' etc

  -- Caption do WhatsApp (texto que veio junto da foto)
  descricao_user text,
  itens jsonb not null default '[]'::jsonb, -- [{nome, gramas, kcal, prot, carb, gord}]

  -- Refeição substituída por correção? (correcoes_alimentos faz append-only)
  substituida_por uuid references public.refeicoes(id),
  ativa boolean not null default true,

  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 1 refeição por foto (idempotência)
  constraint refeicoes_message_unique unique (message_id)
);

create index if not exists refeicoes_user_occurred
  on public.refeicoes (user_id, occurred_at desc)
  where ativa = true;

create index if not exists refeicoes_user_meal_type
  on public.refeicoes (user_id, meal_type, occurred_at desc)
  where ativa = true;

alter table public.refeicoes enable row level security;

drop policy if exists "user full access own refeicoes" on public.refeicoes;
create policy "user full access own refeicoes"
  on public.refeicoes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists refeicoes_touch on public.refeicoes;
create trigger refeicoes_touch before update on public.refeicoes
  for each row execute function public.touch_updated_at();

-- 3. Ledger append-only de correções
create table if not exists public.correcoes_alimentos (
  id uuid primary key default gen_random_uuid(),
  refeicao_id uuid not null references public.refeicoes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Diff aplicado (snapshot pra histórico)
  macros_anteriores jsonb not null, -- {kcal, protein_g, carb_g, fat_g, portion_g}
  macros_corrigidos jsonb not null,

  texto_correcao text not null,      -- "na verdade foi 200g de arroz"
  origem text not null default 'whatsapp', -- 'whatsapp' | 'painel'

  -- Hash chain (audit trail imutável)
  hash_anterior text,
  hash_atual text not null,

  created_at timestamptz not null default now()
);

create index if not exists correcoes_alimentos_refeicao
  on public.correcoes_alimentos (refeicao_id, created_at desc);

alter table public.correcoes_alimentos enable row level security;

drop policy if exists "user full access own correcoes" on public.correcoes_alimentos;
create policy "user full access own correcoes"
  on public.correcoes_alimentos for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 4. Metas nutricionais (kcal/prot/carb/gord por dia)
create table if not exists public.metas_nutricao (
  user_id uuid primary key references auth.users(id) on delete cascade,

  -- Calculado por Harris-Benedict + distribuição padrão (defaults na falta)
  meta_kcal numeric(7, 2),
  meta_protein_g numeric(6, 2),
  meta_carb_g numeric(6, 2),
  meta_fat_g numeric(6, 2),

  -- Origem dos valores (pra UI mostrar)
  origem text not null default 'auto', -- 'auto' (Harris-Benedict) | 'manual' | 'hibrido'

  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.metas_nutricao enable row level security;

drop policy if exists "user full access own metas_nutricao" on public.metas_nutricao;
create policy "user full access own metas_nutricao"
  on public.metas_nutricao for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists metas_nutricao_touch on public.metas_nutricao;
create trigger metas_nutricao_touch before update on public.metas_nutricao
  for each row execute function public.touch_updated_at();

-- 5. Lookup table TBCA (Tabela Brasileira de Composição de Alimentos — USP)
-- Schema simples pra JOIN rápido. Importação via COPY/CSV em seed separado.
create table if not exists public.alimentos_tbca (
  id serial primary key,
  nome text not null,
  nome_normalizado text not null, -- lowercase, sem acentos pra match
  categoria text,                 -- 'cereal', 'leguminosa', 'carne', etc

  kcal_100g numeric(7, 2) not null,
  protein_100g numeric(6, 2),
  carb_100g numeric(6, 2),
  fat_100g numeric(6, 2),

  fonte text not null default 'TBCA/USP'
);

create index if not exists alimentos_tbca_nome_normalizado
  on public.alimentos_tbca using gin (to_tsvector('portuguese', nome_normalizado));

-- TBCA é público, sem RLS (todos podem ler pra autocomplete/lookup)
alter table public.alimentos_tbca enable row level security;

drop policy if exists "public read alimentos_tbca" on public.alimentos_tbca;
create policy "public read alimentos_tbca"
  on public.alimentos_tbca for select using (true);

-- Sem insert/update/delete policy — só migration/seed escreve.

-- 6. Extender `profiles` com dados físicos (Harris-Benedict)
alter table public.profiles
  add column if not exists altura_cm numeric(5, 2),
  add column if not exists peso_kg numeric(5, 2),
  add column if not exists idade int,
  add column if not exists sexo text check (sexo in ('M', 'F'));

-- 7. Adicionar image_storage_path em messages (mesmo padrão de audio_storage_path)
alter table public.messages
  add column if not exists image_storage_path text;

-- 8. RLS do bucket `food-photos` (mesmo padrão do `audios`)
drop policy if exists "user uploads own food photos" on storage.objects;
drop policy if exists "user reads own food photos" on storage.objects;
drop policy if exists "user deletes own food photos" on storage.objects;

create policy "user uploads own food photos" on storage.objects
  for insert with check (
    bucket_id = 'food-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "user reads own food photos" on storage.objects
  for select using (
    bucket_id = 'food-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "user deletes own food photos" on storage.objects
  for delete using (
    bucket_id = 'food-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );


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
