-- Migration 015: view materializada tarefa_patterns
--
-- Agrega últimos 90 dias de `tarefas` por (user_id, categoria) pra
-- injetar memória de padrões no parser de tarefas (paralelo ao que
-- já existe pra financeiro em lib/financeiro/patterns.ts).
--
-- Refresh: o cron `calcular-padroes` (0 4 * * *, em app/api/cron/calcular-padroes)
-- precisa chamar `REFRESH MATERIALIZED VIEW CONCURRENTLY public.tarefa_patterns`
-- depois de rodar o job. Ver nota no fim do arquivo.
--
-- RLS: service role usa direto (cron é server-side). View não tem policy
-- de user — leitura via service role only.

create materialized view if not exists public.tarefa_patterns as
select
  user_id,
  categoria,
  count(*)::int as count,
  -- Dia da semana mais comum (0=domingo, 6=sábado). Pega o de maior contagem.
  mode() within group (order by extract(dow from data_prazo)::int) as dia_semana_mais_comum,
  -- Hora mais comum (0-23). Ignora nulls.
  mode() within group (order by extract(hour from hora_prazo)::int) as hora_mais_comum,
  bool_or(recorrencia is not null) as tem_recorrencia,
  max(data_prazo) as ultima_tarefa_ts,
  -- Prioridade mais comum (low|normal|high). Útil pro parser.
  mode() within group (order by prioridade) as prioridade_mais_comum
from public.tarefas
where data_prazo >= (current_date - interval '90 days')
  and categoria is not null
group by user_id, categoria;

-- Índice pra lookup rápido por user_id (parser sempre filtra por user).
create unique index if not exists tarefa_patterns_user_categoria_idx
  on public.tarefa_patterns (user_id, categoria);

-- Permissões: service role lê direto. Não damos grant pra authenticated
-- porque o parser roda server-side com service client.
grant select on public.tarefa_patterns to service_role;

-- Nota pro programador do cron:
-- Adicionar em `lib/financeiro/patterns.ts:jobCalcularPadroes()` (após
-- o loop de users) a linha:
--   await supabase.rpc('refresh_tarefa_patterns');  -- se criar função
-- OU diretamente:
--   await supabase.from('tarefa_patterns').select('*').limit(0);  -- trigger
-- OU via SQL direto (recomendado, sem mudança de código):
--   await supabase.rpc('exec_sql', { sql: 'refresh materialized view concurrently public.tarefa_patterns' });
--
-- Idempotência: REFRESH CONCURRENTLY só funciona se a view já tem dados
-- (1ª vez precisa REFRESH sem CONCURRENTLY).
