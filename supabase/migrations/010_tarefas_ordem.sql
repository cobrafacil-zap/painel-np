-- Migration 010: ordem manual de tarefas (drag-to-reorder no painel).
--
-- Adiciona coluna `ordem` (int) em tarefas. Default = epoch do created_at,
-- garantindo ordem estável até o usuário arrastar pela primeira vez.
-- Índice parcial cobre só status='pendente' (consulta mais quente: lista
-- de pendentes ordenadas por ordem).

alter table public.tarefas
  add column if not exists ordem int;

-- Backfill: ordem = extract(epoch from created_at)::int para linhas
-- existentes sem ordem (idempotente — só preenche nulos).
update public.tarefas
  set ordem = extract(epoch from created_at)::int
  where ordem is null;

create index if not exists idx_tarefas_user_ordem
  on public.tarefas (user_id, ordem)
  where status = 'pendente';
