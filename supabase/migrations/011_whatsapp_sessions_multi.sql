-- Migration 011 — whatsapp_sessions multi-jid
--
-- Antes: PK era só user_id → contextos de web/celular/grupo colidiam.
-- Agora: PK composta (user_id, remote_jid) → cada JID tem seu contexto.
-- Idempotente.

do $$
begin
  -- Remove a PK antiga se existir
  if exists (
    select 1 from pg_constraint
    where conname = 'whatsapp_sessions_pkey'
      and conrelid = 'public.whatsapp_sessions'::regclass
  ) then
    alter table public.whatsapp_sessions drop constraint whatsapp_sessions_pkey;
  end if;

  -- Cria PK composta
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
