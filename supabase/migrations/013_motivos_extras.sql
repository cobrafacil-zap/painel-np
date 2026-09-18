-- Migration 013: motivos extras do reminder_motivo enum
-- Habilita features #4 (lembretes proativos de contas previstas) e
-- #8 ("esqueci de pagar" — alerta diário pra compromisso vencido)

do $$ begin
  alter type public.reminder_motivo add value if not exists 'compromisso_vencido';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.reminder_motivo add value if not exists 'previsao_conta';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.reminder_motivo add value if not exists 'insight_mensal';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.reminder_motivo add value if not exists 'relatorio_diario';
exception when duplicate_object then null; end $$;

-- Estende lembretes_agendados pra suportar mensagens avulsas (sem
-- tarefa_id) e vinculação a compromisso_parcelas.
alter table public.lembretes_agendados
  add column if not exists parcela_id uuid
    references public.compromisso_parcelas(id) on delete cascade,
  add column if not exists message_text text;

-- tarefa_id agora é opcional (lembrete avulso de #4/#7/#8)
alter table public.lembretes_agendados
  alter column tarefa_id drop not null;
