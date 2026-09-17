-- =========================================================================
-- Migration 006: adiciona coluna categoria em compromissos
-- =========================================================================
--
-- Necessário pra distinguir "conta de luz" (contas_casa) de "aluguel"
-- (moradia) nas consultas e relatórios. Antes, ambos caíam na descrição
-- e o usuário não conseguia somar só as contas de casa.

alter table public.compromissos
  add column if not exists category text;

-- Índice pra queries do tipo "quanto gastei de contas_casa esse mês"
create index if not exists compromissos_user_category_idx
  on public.compromissos (user_id, category)
  where category is not null;
