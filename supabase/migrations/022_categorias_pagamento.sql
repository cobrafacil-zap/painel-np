-- 022_categorias_pagamento.sql
-- Categorias do financeiro:
--   * adiciona 'Crediário' e 'Cartão de crédito' como categorias padrão
--   * remove a categoria 'droga' (criada por auto-categorização)
-- Obs.: a correção de dados já foi aplicada via scripts/fix-categorias.mjs;
-- este arquivo mantém o seed novo e serve pra outros ambientes.

-- 1) Seed atualizada (usuários novos)
create or replace function public.seed_default_categories(p_user_id uuid)
returns void language plpgsql security definer as $$
begin
  insert into public.categories (user_id, module_id, slug, label, icon, color, is_system)
  values
    (p_user_id, 'financeiro', 'mercado',       'Mercado',        'ShoppingCart',  '#10b981', true),
    (p_user_id, 'financeiro', 'transporte',    'Transporte',     'Car',           '#3b82f6', true),
    (p_user_id, 'financeiro', 'alimentacao',   'Alimentação',    'Utensils',      '#f59e0b', true),
    (p_user_id, 'financeiro', 'moradia',       'Moradia',        'Home',          '#8b5cf6', true),
    (p_user_id, 'financeiro', 'saude',         'Saúde',          'Heart',         '#ef4444', true),
    (p_user_id, 'financeiro', 'lazer',         'Lazer',          'Smile',         '#ec4899', true),
    (p_user_id, 'financeiro', 'educacao',      'Educação',       'GraduationCap', '#06b6d4', true),
    (p_user_id, 'financeiro', 'assinaturas',   'Assinaturas',    'Repeat',        '#a855f7', true),
    (p_user_id, 'financeiro', 'freelance',     'Freelance',      'Briefcase',     '#22c55e', true),
    (p_user_id, 'financeiro', 'salario',       'Salário',        'Banknote',      '#16a34a', true),
    (p_user_id, 'financeiro', 'investimentos', 'Investimentos',  'TrendingUp',    '#0ea5e9', true),
    (p_user_id, 'financeiro', 'posto',         'Posto',          'Fuel',          '#f97316', true),
    (p_user_id, 'financeiro', 'crediario',     'Crediário',      'CreditCard',    '#0ea5e9', true),
    (p_user_id, 'financeiro', 'cartao_credito','Cartão de crédito','CreditCard',  '#6366f1', true),
    (p_user_id, 'financeiro', 'outros',        'Outros',         'Circle',        '#6b7280', true)
  on conflict (user_id, module_id, slug) do nothing;
end $$;

-- 2) Backfill pra usuários existentes
insert into public.categories (user_id, module_id, slug, label, icon, color, is_system)
select p.id, 'financeiro', v.slug, v.label, v.icon, v.color, true
from public.profiles p
cross join (values
  ('crediario',      'Crediário',        'CreditCard', '#0ea5e9'),
  ('cartao_credito', 'Cartão de crédito','CreditCard', '#6366f1')
) as v(slug, label, icon, color)
on conflict (user_id, module_id, slug) do nothing;

-- 3) Remove a categoria 'droga'
update public.records set category = 'outros' where category = 'droga';
delete from public.categories where slug = 'droga' or label = 'Droga';
