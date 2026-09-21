-- Migration 017: metas financeiras de longo prazo + valor guardado manual
--
-- User pode definir várias metas simultâneas tipo:
--   "quero juntar 100k pra casa em 5 anos"
--   "trocar de carro em 2 anos"
--
-- Sistema calcula automaticamente:
--   - quanto precisa guardar por mês (= valor / meses restantes)
--   - projeção de quando atinge (se mantiver o ritmo atual)
--   - se tá no prazo ou atrasado
--
-- Valor guardado é INFORMADO MANUALMENTE pelo user ("já juntei 30k")
-- porque não temos como saber o que ele tem em investimentos/contas
-- fora do que registra aqui. Pode atualizar quando quiser.
--
-- Tabela separada (não jsonb em user_settings) pra:
--   - queries simples (list, filter por prazo)
--   - poder deletar/criar sem mexer no resto das settings
--   - histórico de criação/atualização individual por meta

create table if not exists public.metas_longas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,                              -- ex: "juntar 100k pra casa"
  valor_alvo numeric(12, 2) not null,              -- 100000.00
  prazo_meses int not null,                        -- 60 (= 5 anos)
  valor_guardado numeric(12, 2) not null default 0,
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint metas_longas_valor_alvo_positivo check (valor_alvo > 0),
  constraint metas_longas_prazo_positivo check (prazo_meses > 0),
  constraint metas_longas_valor_guardado_nao_negativo check (valor_guardado >= 0)
);

-- Constraint: não permite valor_guardado > valor_alvo (sanidade)
-- Não uso CHECK direto pra permitir overshoot caso user queira
-- seguir guardando depois de bater a meta (faz sentido psicologicamente).

-- Índices: queries sempre filtram por user_id + ativa
create index if not exists metas_longas_user_ativas
  on public.metas_longas (user_id, ativa, created_at desc)
  where ativa = true;

create index if not exists metas_longas_user_all
  on public.metas_longas (user_id, created_at desc);

-- RLS
alter table public.metas_longas enable row level security;

drop policy if exists "user full access own metas_longas" on public.metas_longas;
create policy "user full access own metas_longas"
  on public.metas_longas for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Trigger updated_at (função criada em migration 012)
drop trigger if exists metas_longas_touch on public.metas_longas;
create trigger metas_longas_touch before update on public.metas_longas
  for each row execute function public.touch_updated_at();
