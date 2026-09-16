# Painel NP

Painel pessoal modular (começando pelo Financeiro), com integração via WhatsApp
usando a mesma Evolution API já configurada para o PAINEL GL.

## Stack

- Next.js 15 (App Router) + TypeScript
- TailwindCSS + shadcn/ui (visual)
- Supabase (Auth + Postgres + RLS)
- Recharts (gráficos)
- Vercel AI SDK + Groq (parser de mensagens WhatsApp)
- Evolution API (mesmo container do PAINEL GL, instância dedicada `painel-np`)
- Deploy: Vercel

## Como rodar localmente

```bash
npm install
cp .env.example .env.local
# edite .env.local com suas chaves
npm run dev
```

Acesse `http://localhost:3000`.

## Setup único (novo projeto Supabase)

1. Crie projeto em https://supabase.com
2. SQL Editor → cole `supabase/schema.sql` → Run
3. Authentication → Users → Add user (seu email + senha)
4. SQL Editor → rode a migration `supabase/migrations/001_whatsapp_group.sql` (adiciona coluna `whatsapp_group_jid` em profiles).
5. O JID do grupo será salvo depois via UI em `/painel/whatsapp` (não precisa fazer manualmente).

5. Anote `anon` e `service_role` em Project Settings → API → coloque em `.env.local`.

## Setup WhatsApp (instância Evolution `painel-np` + grupo dedicado)

Você vai usar um **grupo dedicado** do WhatsApp (só você) como canal de entrada/saída do painel.
Não usamos seu número pessoal — usamos um grupo chamado tipo "💰 Painel NP". Vantagens:

- Risco de banimento próximo de zero (grupo seu, controle total).
- Sem misturar mensagens pessoais.
- Multi-device: você lê o grupo no celular e o painel responde lá também.

### Passo a passo

1. Confirme que a Evolution API está rodando (mesmo container do PAINEL GL).
2. **Crie a instância `painel-np`** na Evolution:

```bash
curl -X POST https://evolution.metodogl.site/instance/create \
  -H "apikey: $EVOLUTION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"instanceName":"painel-np","qrcode":true}'
```

3. **Abra o painel** (`/painel/whatsapp`), escaneie o QR no celular e conecte.
4. **Crie um grupo no WhatsApp** com só você (ex: "💰 Painel NP"). Esse será o canal.
5. **Volte no painel**, em `/painel/whatsapp` → selecione o grupo recém-criado → Salvar.
6. **Configure o webhook** apontando pro painel:

```bash
curl -X POST https://sua-url.vercel.app/api/evolution/setup-webhook \
  -H "Cookie: sua-sessao-supabase"
```

Isso grava na Evolution:
- URL: `https://sua-url.vercel.app/api/whatsapp/webhook`
- Eventos: `MESSAGES_UPSERT`
- Header custom: `X-Webhook-Secret: <WEBHOOK_SECRET>`

O webhook filtra por JID: só processa mensagens do grupo vinculado.
Mensagens de outros grupos da mesma instância são silenciosamente ignoradas.

## Estrutura

```
supabase/schema.sql         # DDL + RLS + seed de categorias
lib/                        # utils + evolution client (reaproveitado)
lib/supabase/               # clients (server/client/service_role)
app/                        # App Router
  (auth)/login              # login/signup
  (app)/                    # área logada
    painel/                 # dashboard agregado
    financeiro/             # módulo financeiro (MVP)
app/api/
  financeiro/               # CRUD do módulo
  whatsapp/                 # webhook + parser IA
  evolution/                # setup do webhook
modules/financeiro/lib/     # parser IA + consultas
```

## Segurança

- `service_role` key **nunca** é usada no frontend (só em rotas serverless).
- `.env.local` está no `.gitignore`.
- RLS habilitado em todas as tabelas.
- Webhook validado por header `X-Webhook-Secret` se `WEBHOOK_SECRET` estiver definido.

## Roadmap (Parte 5)

- Módulo **Treino** (records com `metadata` para carga/reps/séries)
- Módulo **Saúde** (sono, hidratação, peso)
- Pipeline WhatsApp é genérico: cada módulo define seu próprio parser de IA.

