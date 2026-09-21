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
