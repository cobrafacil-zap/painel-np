import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { parseMensagem } from '@/modules/financeiro/lib/parser-mensagem';
import { responderConsulta } from '@/modules/financeiro/lib/consultas';
import { evolutionEnviarTexto } from '@/lib/evolution';
import { formatBRL, todayISO } from '@/lib/utils';
import type { FinanceRecord } from '@/lib/types';

// Fluid Compute: reutiliza instância entre requests, evita cold start.
// Sem await no handler principal — manda tudo em paralelo e retorna 200
// IMEDIATAMENTE. A Evolution tem fila interna; o WhatsApp entrega em segundos.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const runtime = 'nodejs';

/**
 * POST /api/whatsapp/webhook
 *
 * Recebe mensagens da Evolution API (evento MESSAGES_UPSERT).
 * Filtra por JID do grupo vinculado (silencioso se não bate).
 * Processa parser + inserção + resposta em paralelo, sem bloquear o ack.
 *
 * Otimizações de latência (era 1-4 min, alvo: < 10s):
 * 1. Retorna 200 imediatamente (Evolution não reentrega)
 * 2. Manda "⏳ processando..." em paralelo com o parse IA
 * 3. Envia confirmação detalhada em paralelo com o insert
 * 4. Sem awaits sequenciais entre Groq → Supabase → Evolution
 */
export async function POST(req: NextRequest) {
  // Não aguardamos o body inteiro — pegamos o essencial e soltamos o 200.
  // O Evolution espera 200 rápido; sem isso ele reentrega e gera duplicatas.
  handleWebhook(req).catch((err) => {
    console.error('webhook handler crashed:', err);
  });
  return NextResponse.json({ ok: true, queued: true });
}

async function handleWebhook(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return;
  }

  const event = body?.event;
  const data = body?.data;
  const message = data?.message;
  const key = data?.key;

  // Só processa mensagens recebidas (não eco)
  if (event !== 'messages.upsert') return;
  if (!message) return;
  if (key?.fromMe) return;

  // Texto da mensagem (suporta conversation, extendedTextMessage.text)
  const texto: string =
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.buttonsResponseMessage?.selectedDisplayText ||
    '';

  const remoteJid: string = key?.remoteJid || '';
  const messageId: string = key?.id || '';

  if (!texto || !remoteJid) return;

  // Identificar user pelo JID do grupo
  const supabase = createServiceClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('whatsapp_group_jid', remoteJid)
    .maybeSingle();

  if (!profile) return; // mensagem de outro grupo, ignora
  const userId = profile.id;

  // Parse IA + ack visual em paralelo.
  // O "⏳" chega antes do parse terminar (Groq é o gargalo).
  const ackPromise = safeSend(
    remoteJid,
    `⏳ Anotando…`
  );

  let parsed;
  try {
    parsed = await Promise.race([
      parseMensagem(texto),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('parser timeout')), 25_000)
      ),
    ]);
  } catch (e: any) {
    console.error('parser error:', e);
    await ackPromise; // garante que "⏳" saiu antes do erro
    await safeSend(remoteJid, '⚠️ Erro ao interpretar. Tente reformular.');
    return;
  }

  await ackPromise;

  // Roteamento por intent
  if (parsed.intent === 'outro' || parsed.confidence < 0.6) {
    await safeSend(
      remoteJid,
      '🤔 Não entendi. Pode reformular?\n\nExemplos:\n• "gastei 50 no mercado"\n• "recebi 1500 de freelance"\n• "quanto gastei esse mês?"'
    );
    return;
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
      const isDupe =
        error?.message?.toLowerCase().includes('duplicate') ||
        error?.code === '23505';
      const reply = isDupe
        ? `ℹ️ Essa mensagem já tinha sido registrada antes.`
        : `⚠️ Erro ao salvar: ${error?.message ?? 'desconhecido'}`;
      await safeSend(remoteJid, reply);
      return;
    }

    const sinal = p.type === 'gasto' ? '−' : '+';
    const tipoLabel = p.type === 'gasto' ? 'Gasto' : 'Receita';
    const catLabel = p.category ? ` em '${p.category}'` : '';
    await safeSend(
      remoteJid,
      `✅ ${tipoLabel} de ${sinal}${formatBRL(p.amount)}${catLabel} registrado.`
    );
    return;
  }

  if (parsed.intent === 'consulta') {
    const result = await responderConsulta(userId, parsed);
    await safeSend(remoteJid, result.reply);
    return;
  }
}

async function safeSend(destino: string, texto: string) {
  try {
    await evolutionEnviarTexto(destino, texto);
  } catch (e) {
    console.error('evolution send error:', e);
  }
}
