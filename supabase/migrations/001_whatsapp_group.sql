-- =========================================================================
-- Migration 001: adiciona whatsapp_group_jid em profiles
-- Rode depois do schema.sql inicial.
-- =========================================================================

alter table public.profiles
  add column if not exists whatsapp_group_jid text;

-- Validação leve: se preenchido, deve terminar com @g.us (formato de grupo)
alter table public.profiles
  drop constraint if exists profiles_group_jid_format;
alter table public.profiles
  add constraint profiles_group_jid_format
  check (whatsapp_group_jid is null or whatsapp_group_jid like '%@g.us');
