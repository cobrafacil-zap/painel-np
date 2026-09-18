-- Migration 014: meta diária de gastos
-- Permite ao user definir limite de gasto diário (ex: "definir meta
-- diária de 100") e receber aviso quando chegar próximo (80%) ou
-- estourar durante o dia.

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  meta_diaria numeric(12, 2),
  updated_at timestamptz default now()
);

alter table public.user_settings enable row level security;
create policy "user full access own settings" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();
