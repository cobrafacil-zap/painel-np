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
