-- =========================================================================
-- Migration 002: adiciona categoria "posto"
-- =========================================================================

insert into public.categories (user_id, module_id, slug, label, icon, color, is_system)
select id, 'financeiro', 'posto', 'Posto', 'Fuel', '#f97316', true
from auth.users
on conflict (user_id, module_id, slug) do nothing;
