-- Migration 012 — user_patterns
--
-- Tabela que armazena padrões aprendidos dos gastos do usuário.
-- Permite projeções ("luz costuma vir dia 5"), auto-complete de
-- mensagens vagas ("paguei a luz" → completa valor/data) e lembretes
-- proativos (#4).

create table if not exists public.user_patterns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,

  -- Chave do padrão: "category:keyword". ex: 'contas_casa:luz',
  -- 'mercado:geral', 'moradia:aluguel'.
  pattern_key text not null,

  -- Tipo de padrão:
  --   'recurring_fixed':     valor estável, mesmo dia do mês (luz, aluguel)
  --   'recurring_variable':  valor varia (mercado, restaurante)
  --   'avg_spend':           gasto médio sem recorrência clara
  pattern_type text not null,

  -- Estatísticas
  avg_amount numeric(12,2),
  stddev_amount numeric(12,2),
  day_of_month int,                  -- dia típico (1-31). null se variável
  frequency text,                    -- 'monthly' | 'weekly' | 'irregular'

  -- Contadores
  sample_count int default 0,

  -- Última ocorrência
  last_seen_at timestamptz,

  -- Próxima ocorrência prevista (pra lembrete proativo)
  next_expected_date date,
  next_expected_amount numeric(12,2),

  -- Metadata livre (ex: fornecedor detectado)
  metadata jsonb default '{}'::jsonb,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique(user_id, pattern_key)
);

create index if not exists user_patterns_user_idx
  on public.user_patterns (user_id);

create index if not exists user_patterns_next_expected_idx
  on public.user_patterns (user_id, next_expected_date)
  where next_expected_date is not null;

-- Service role usa direto (cron roda server-side).
alter table public.user_patterns enable row level security;

-- Trigger pra updated_at
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists user_patterns_touch_updated_at on public.user_patterns;
create trigger user_patterns_touch_updated_at
  before update on public.user_patterns
  for each row execute function public.touch_updated_at();
