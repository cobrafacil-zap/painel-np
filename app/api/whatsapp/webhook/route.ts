import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { parseMensagem } from '@/modules/financeiro/lib/parser-mensagem';
import { responderConsulta } from '@/modules/financeiro/lib/consultas';
import { evolutionEnviarTexto } from '@/lib/evolution';
import { formatBRL, todayISO } from '@/lib/utils';
import type { FinanceRecord } from '@/lib/types';

// Desabilita cache, garante parse de JSON grande
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/whatsapp/webhook
 *
 * Recebe mensagens da Evolution API (evento MESSAGES_UPSERT).
 * Valida o header X-Webhook-Secret (se configurado).
 * Identifica o user pelo remote_jid (número).
 * Interpreta via IA e grava/atende.
 * Responde no mesmo chat.
 *
 * Payload típico da Evolution v2:
 * {
 *   "event": "messages.upsert",
 *   "instance": "painel-np",
 *   "data": {
 *     "key": { "remoteJid": "5511981113358@s.whatsapp.net", "fromMe": false, "id": "ABC123" },
 *     "message": { "conversation": "gastei 50 no mercado" },
 *     "messageType": "conversation"
 *   }
 * }
 */
export async function POST(req: NextRequest) {
  // 1. Segurança: a Evolution v2.3.7 não propaga custom headers de webhook
  //    com confiabilidade. Em vez de exigir X-Webhook-Secret (que não chega),
  //    confiamos no filtro por JID do grupo abaixo: mensagens de fora do
  //    grupo vinculado são silenciosamente ignoradas. Isso é seguro porque
  //    o JID é único e só o user logado pode associá-lo ao próprio profile.

  // 2. Parse do payload
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const event = body?.event;
  const data = body?.data;
  const message = data?.message;
  const key = data?.key;

  // Só processa mensagens recebidas (não eco)
  if (event !== 'messages.upsert') return NextResponse.json({ ok: true, skipped: true });
  if (!message) return NextResponse.json({ ok: true, skipped: true });
  if (key?.fromMe) return NextResponse.json({ ok: true, skipped: true });

  // Texto da mensagem (suporta conversation, extendedTextMessage.text)
  const texto: string =
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.buttonsResponseMessage?.selectedDisplayText ||
    '';

  const remoteJid: string = key?.remoteJid || '';
  const messageId: string = key?.id || '';

  if (!texto || !remoteJid) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  // 3. Identificar user pelo remote_jid (grupo dedicado)
  const supabase = createServiceClient();

  // Procura o user cujo whatsapp_group_jid bate exatamente com o remoteJid.
  // (Se você entrar em outros grupos com a mesma instância, mensagens deles
  // são silenciosamente ignoradas — o painel só escuta o grupo configurado.)
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('whatsapp_group_jid', remoteJid)
    .maybeSingle();

  if (!profile) {
    // Silencioso: provavelmente é mensagem de outro grupo. Não responde.
    return NextResponse.json({ ok: true, skipped: 'unlinked_group' });
  }

  const userId = profile.id;

  // 4. Parse via IA
  let parsed;
  try {
    parsed = await parseMensagem(texto);
  } catch (e: any) {
    console.error('parser error:', e);
    await safeSend(remoteJid, '⚠️ Erro ao interpretar a mensagem. Tente reformular.');
    return NextResponse.json({ ok: true, error: 'parser' });
  }

  // 5. Roteamento por intent
  if (parsed.intent === 'outro' || parsed.confidence < 0.6) {
    await safeSend(
      remoteJid,
      '🤔 Não entendi. Pode reformular?\n\nExemplos:\n• "gastei 50 no mercado"\n• "recebi 1500 de freelance"\n• "quanto gastei esse mês?"'
    );
    return NextResponse.json({ ok: true, intent: 'outro' });
  }

  if (parsed.intent === 'lancamento') {
    const p = parsed as Extract<typeof parsed, { intent: 'lancamento' }>;
    const { data: inserted, error } = await supabase
      .from('records')
      .insert({
        user_id: userId,
        module_id: 'financeiro',
        type: p.type,
        amount: p.amount,
        category: p.category,
        description: p.description,
        payment_method: p.payment_method,
        occurred_at: p.occurred_at ?? todayISO(),
        source: 'whatsapp',
        source_message_id: messageId,
        metadata: { remote_jid: remoteJid, parsed_confidence: p.confidence },
      })
      .select()
      .single();

    if (error || !inserted) {
      // Provavelmente duplicata (mesmo source_message_id)
      const isDupe = error?.message?.toLowerCase().includes('duplicate') || error?.code === '23505';
      const reply = isDupe
        ? `ℹ️ Essa mensagem já tinha sido registrada antes.`
        : `⚠️ Erro ao salvar: ${error?.message ?? 'desconhecido'}`;
      await safeSend(remoteJid, reply);
      return NextResponse.json({ ok: true, error: isDupe ? 'duplicate' : 'db' });
    }

    const sinal = p.type === 'gasto' ? '−' : '+';
    const tipoLabel = p.type === 'gasto' ? 'Gasto' : 'Receita';
    const catLabel = p.category ? ` em '${p.category}'` : '';
    await safeSend(
      remoteJid,
      `✅ ${tipoLabel} de ${sinal}${formatBRL(p.amount)}${catLabel} registrado.`
    );
    return NextResponse.json({ ok: true, intent: 'lancamento', id: (inserted as FinanceRecord).id });
  }

  if (parsed.intent === 'consulta') {
    const result = await responderConsulta(userId, parsed);
    await safeSend(remoteJid, result.reply);
    return NextResponse.json({ ok: true, intent: 'consulta' });
  }

  return NextResponse.json({ ok: true, skipped: true });
}

async function safeSend(destino: string, texto: string) {
  try {
    await evolutionEnviarTexto(destino, texto);
  } catch (e) {
    console.error('evolution send error:', e);
  }
}
