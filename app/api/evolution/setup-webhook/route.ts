import { NextRequest, NextResponse } from 'next/server';
import { requireUser, createClient } from '@/lib/supabase/server';
import { evolutionConfigurarWebhook } from '@/lib/evolution';

/**
 * POST /api/evolution/setup-webhook
 *
 * Configura a Evolution para entregar mensagens em
 *   {NEXT_PUBLIC_APP_URL}/api/whatsapp/webhook
 * com header X-Webhook-Secret = WEBHOOK_SECRET.
 *
 * Por padrão usa a instância do usuário logado (do profile). O body pode
 * omitir `{ instance }` ou passar uma instância explícita.
 *
 * NOTA: após deploy do provisionamento por usuário, essa rota normalmente
 * não precisa ser chamada pelo usuário — `provisionarInstancia()` já
 * configura o webhook automaticamente. Mantida para correção manual caso
 * a Evolution "perca" a config (raro, mas acontece após restart).
 */
export async function POST(req: NextRequest) {
  const { userId } = await requireUser();
  const supabase = await createClient();

  let instanceFromBody: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    instanceFromBody = typeof body?.instance === 'string' ? body.instance : undefined;
  } catch {
    // body vazio é ok
  }

  // Resolve instance: body > profile > env (legacy)
  let instance = instanceFromBody;
  if (!instance) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('evolution_instance_name')
      .eq('id', userId)
      .single();
    instance = profile?.evolution_instance_name ?? process.env.EVOLUTION_INSTANCE;
  }

  if (!instance) {
    return NextResponse.json(
      { error: 'Nenhuma instância definida (profile sem instance e sem env EVOLUTION_INSTANCE).' },
      { status: 400 }
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) {
    return NextResponse.json(
      { error: 'NEXT_PUBLIC_APP_URL não definida' },
      { status: 500 }
    );
  }

  const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/whatsapp/webhook`;
  const secret = process.env.WEBHOOK_SECRET;

  try {
    await evolutionConfigurarWebhook(instance, webhookUrl, secret);
    return NextResponse.json({ ok: true, instance, webhook: webhookUrl });
  } catch (e: any) {
    console.error('[evolution/setup-webhook]', e);
    return NextResponse.json({ error: e?.message ?? 'erro' }, { status: 500 });
  }
}
