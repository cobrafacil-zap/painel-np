-- Migration 009: Mais granularidade de avisos de lembrete.
--
-- Antes: aviso_previo (1 dia antes) + aviso_imediato (1h15 antes).
-- Agora: compromisso tem 3 avisos (1 dia antes + 30min + 15min antes),
--        recorrente tem 2 avisos (1h15 + 30min antes — só curto prazo).
-- Prazo e atraso_diario ficam iguais.
--
-- Novos motivos:
--   aviso_30min:    30 minutos antes do compromisso (substitui
--                   aviso_imediato 1h15 — agora é o "imediato" mesmo).
--   aviso_15min:    15 minutos antes (só pra compromisso).
--   aviso_curto:    marcador genérico pra recorrente (1h15 antes).
--
-- Migration idempotente: exception when duplicate_object then null.
do $$ begin
  alter type public.reminder_motivo add value if not exists 'aviso_30min';
exception when duplicate_object then null; end $$;
do $$ begin
  alter type public.reminder_motivo add value if not exists 'aviso_15min';
exception when duplicate_object then null; end $$;
do $$ begin
  alter type public.reminder_motivo add value if not exists 'aviso_curto';
exception when duplicate_object then null; end $$;
