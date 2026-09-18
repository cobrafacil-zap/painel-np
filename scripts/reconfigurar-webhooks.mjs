#!/usr/bin/env node
/**
 * Reconfigura TODAS as instâncias Evolution do container pra apontarem pro
 * webhook do painel com base64:true (necessário pra transcrição de áudio).
 *
 * Uso: node scripts/reconfigurar-webhooks.mjs
 */

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || 'https://evolution.metodogl.site';
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY;
const PANEL_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://painel-np.vercel.app';
const WEBHOOK_PATH = '/api/whatsapp/webhook';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!EVOLUTION_KEY) {
  console.error('EVOLUTION_API_KEY não definida. Exporte antes de rodar.');
  process.exit(1);
}

async function main() {
  // Lista todas as instâncias
  const res = await fetch(`${EVOLUTION_URL}/instance/fetchInstances`, {
    headers: { apikey: EVOLUTION_KEY },
  });
  if (!res.ok) {
    console.error('Falha ao listar:', res.status, await res.text());
    process.exit(1);
  }
  const instances = await res.json();
  console.log(`Encontradas ${instances.length} instância(s).`);

  const webhookUrl = `${PANEL_URL.replace(/\/$/, '')}${WEBHOOK_PATH}`;
  console.log(`Reconfigurando pra: ${webhookUrl} (base64:true)\n`);

  for (const inst of instances) {
    const name = inst.name || inst.instanceName || inst.id;
    console.log(`--- ${name} ---`);
    try {
      const body = {
        webhook: {
          enabled: true,
          url: webhookUrl,
          webhook_by_events: false,
          webhook_base64: true,
          events: ['MESSAGES_UPSERT'],
        },
      };
      if (WEBHOOK_SECRET) {
        body.webhook_custom_headers = [
          { name: 'X-Webhook-Secret', value: WEBHOOK_SECRET },
        ];
      }
      const r = await fetch(`${EVOLUTION_URL}/webhook/set/${name}`, {
        method: 'POST',
        headers: { apikey: EVOLUTION_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const txt = await r.text();
      console.log(`  ${r.ok ? 'OK' : 'FALHOU'} (${r.status}): ${txt.slice(0, 200)}`);
    } catch (e) {
      console.log(`  ERRO: ${e.message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
