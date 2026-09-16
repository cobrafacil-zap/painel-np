# Roadmap Futuro — PAINEL NP

## Princípio

A arquitetura foi desenhada **multi-módulo desde o dia 1**. Adicionar um novo módulo
(treino, saúde, etc.) **não exige migração pesada** — só:

1. Inserir uma linha em `modules` (id, label, icon).
2. Gravar registros em `records` com `module_id = '<novo>'` e os dados específicos em `metadata`.
3. (Opcional) Criar tabelas específicas (ex: `workouts`, `sleep_logs`) com FK para `user_id`.

## Módulos planejados

### Treino
- `records` com `metadata` = `{ exercise, sets, reps, weight_kg, rpe, notes }`
- Visualização: calendário de treinos, evolução de carga por exercício (gráfico de linha), PRs
- WhatsApp: "treino A: supino 80kg 4x8, agachamento 100kg 5x5" → parser extrai, grava em `metadata`

### Saúde
- `records` com `metadata` = `{ metric: 'sono'|'hidratacao'|'peso'|'humor', value, unit }`
- Visualização: séries temporais, médias semanais
- WhatsApp: "dormi 7h", "bebi 2L de água", "peso 78.5kg"

### Outros (a definir)
- Hábitos, leituras, estudos, trabalho, projetos — tudo via `records` + `metadata`.

## Pipeline WhatsApp (genérico)

Hoje: `webhook → parser-IA-financeiro → INSERT record → resposta`.

Amanhã: a rota `/api/whatsapp/webhook` delega para o parser do módulo certo.
Estratégia possível:
- Mensagens começando com `/treino` ou `/saude` → módulo explícito.
- Sem prefixo → tentar detectar pelo conteúdo (palavras-chave: "treino", "peso", "dormi").
- Cada módulo exporta um `parse()` com o mesmo contrato `{ intent, ... }`.

## Segurança

- RLS por `user_id` em **todas** as tabelas de records/budgets/etc.
- Service role key **só em rotas serverless** (webhook) — nunca no frontend.
- Webhook validado por header `X-Webhook-Secret`.

## Quando quiser implementar

1. Adicionar linha em `modules`
2. Criar migration com tabelas específicas (se precisar)
3. Adicionar `modules/<nome>/lib/parser-mensagem.ts`
4. Adicionar rota `/api/<modulo>/*` (REST)
5. Adicionar páginas em `app/(app)/<modulo>/`
6. Adicionar link na sidebar

Sem refatoração no código existente. Sem retrabalho no webhook.
