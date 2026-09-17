-- ============================================================================
-- 005_user_evolution_instance.sql
--
-- Adiciona colunas em `profiles` para que cada usuário tenha sua própria
-- instância Evolution API (isolamento total, ao invés de 1 instância global).
--
-- Também cria a função `gen_evolution_instance_name()` que gera um nome único
-- no formato `painel-np-XXXXXX` (sufixo aleatório de 6 chars).
--
-- BACKFILL: preenche `evolution_instance_name = 'painel-np'` pro profile do
-- Nicolas (que já tem whatsapp_group_jid vinculado à instância legada).
-- ============================================================================

alter table public.profiles
  add column if not exists evolution_instance_name text unique,
  add column if not exists evolution_status text not null default 'pending'
    check (evolution_status in ('pending', 'qr', 'connecting', 'open', 'closed')),
  add column if not exists evolution_owner_jid text,
  add column if not exists evolution_created_at timestamptz;

-- Backfill do Nicolas (instância atual, não muda comportamento)
update public.profiles
  set evolution_instance_name = 'painel-np',
      evolution_status = 'open',
      evolution_created_at = coalesce(evolution_created_at, now())
  where whatsapp_group_jid is not null
    and evolution_instance_name is null;

-- Função utilitária: gera nome único de instância Evolution.
-- Loop pra evitar colisão caso a primeira tentativa já exista na tabela.
create or replace function public.gen_evolution_instance_name() returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  novo text;
begin
  loop
    novo := 'painel-np-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    exit when not exists (
      select 1 from public.profiles where evolution_instance_name = novo
    );
  end loop;
  return novo;
end $$;

-- Comentário pra documentar
comment on column public.profiles.evolution_instance_name is
  'Nome único da instância Evolution API deste usuário (ex: painel-np-a1b2c3).';
comment on column public.profiles.evolution_status is
  'Estado atual da instância Evolution (pending|qr|connecting|open|closed).';
comment on column public.profiles.evolution_owner_jid is
  'JID do WhatsApp conectado (ex: 5511999887766@s.whatsapp.net). Preenchido quando state=open.';
