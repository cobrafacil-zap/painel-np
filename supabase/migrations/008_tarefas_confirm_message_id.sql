-- =========================================================================
-- Migration 008: adiciona confirm_message_id em tarefas
-- Necessário pro handler de reação ✅ no webhook — ao reagir à msg
-- de confirmação do bot, o handler faz lookup por esse id.
-- =========================================================================

alter table public.tarefas
  add column if not exists confirm_message_id text;

create index if not exists tarefas_confirm_msg_idx
  on public.tarefas (confirm_message_id)
  where confirm_message_id is not null;
