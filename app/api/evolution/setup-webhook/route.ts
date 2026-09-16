import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';
import { evolutionConfigurarWebhook } from '@/lib/evolution';

/**
 * POST /api/evolution/setup-webhook
 *
 * Configura a Evolution para entregar mensagens em
 *   {NEXT_PUBLIC_APP_URL}/api/whatsapp/webhook
 * com header X-Webhook-Secret = WEBHOOK_SECRET.
 *
 * Uso: faça 1x após deploy (ou após trocar o domínio).
 */
export async function POST(_req: NextRequest) {
  await requireUser();

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL não definida' }, { status: 500 });
  }

  const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/whatsapp/webhook`;
  const secret = process.env.WEBHOOK_SECRET;

  try {
    await evolutionConfigurarWebhook(webhookUrl, secret);
    return NextResponse.json({ ok: true, webhook: webhookUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'erro' }, { status: 500 });
  }
}
