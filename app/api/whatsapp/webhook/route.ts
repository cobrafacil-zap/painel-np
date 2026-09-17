import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { parseMensagem } from '@/modules/financeiro/lib/parser-mensagem';
import { responderConsulta } from '@/modules/financeiro/lib/consultas';
import { evolutionEnviarTexto } from '@/lib/evolution';
import { formatBRL, todayISO } from '@/lib/utils';
import type { FinanceRecord } from '@/lib/types';

// Fluid Compute: roda em São Paulo (gru1), perto do Contabo.
// Processamento paralelo: ack visual sai em paralelo com parse IA,
// confirmação detalhada sai em paralelo com insert. Tempo total ≈
// max(Groq, Supabase, Evolution) em vez da soma.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const runtime = 'nodejs';

/**
 * POST /api/whatsapp/webhook
 *
 * Recebe mensagens da Evolution API (evento MESSAGES_UPSERT).
 * Filtra por JID do grupo vinculado.
 *
 * OTIMIZAÇÕES (era 1-4min → alvo <10s):
 * 1. ack visual "⏳" sai em paralelo com o parse IA (Groq é o gargalo)
 * 2. confirmação "✅" sai em paralelo com o insert no Supabase
 * 3. tudo dentro de um único await chain, sem fire-and-forget
 *    (Fluid Compute mata background promises depois do response)
 */
export async function POST(req: NextRequest) {
  // 1. Parse do payload
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

  // 2. Identificar user pelo JID do grupo
  const supabase = createServiceClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('whatsapp_group_jid', remoteJid)
    .maybeSingle();

  if (!profile) return NextResponse.json({ ok: true, skipped: 'unlinked_group' });
  const userId = profile.id;

  // 3. ACK VISUAL em paralelo com parse IA.
  // O ack sai imediatamente (Evolution tem fila interna, entrega em ms),
  // o parser roda em paralelo. Quando o parser terminar, mandamos a
  // confirmação detalhada.
  const ackPromise = safeSend(remoteJid, `⏳ Anotando…`);

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
    await ackPromise;
    await safeSend(remoteJid, '⚠️ Erro ao interpretar. Tente reformular.');
    return NextResponse.json({ ok: true, error: 'parser' });
  }

  // Garante que o "⏳" saiu antes da confirmação
  await ackPromise;

  // 4. Roteamento por intent
  if (parsed.intent === 'outro' || parsed.confidence < 0.6) {
    await safeSend(
      remoteJid,
      '🤔 Não entendi. Pode reformular?\n\nExemplos:\n• "gastei 50 no mercado"\n• "recebi 1500 de freelance"\n• "quanto gastei esse mês?"'
    );
    return NextResponse.json({ ok: true, intent: 'outro' });
  }

  if (parsed.intent === 'lancamento') {
    const p = parsed as Extract<typeof parsed, { intent: 'lancamento' }>;

    // Pre-monta a string de confirmação (sem await, é puro)
    const sinal = p.type === 'gasto' ? '−' : '+';
    const tipoLabel = p.type === 'gasto' ? 'Gasto' : 'Receita';
    const catLabel = p.category ? ` em '${p.category}'` : '';
    const confirmacao = `✅ ${tipoLabel} de ${sinal}${formatBRL(p.amount)}${catLabel} registrado.`;

    // INSERT e ENVIO em paralelo: o usuário recebe a confirmação junto com
    // (ou logo após) o commit no banco. Sem serializar.
    const [insertResult] = await Promise.all([
      supabase
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
        .single(),
      safeSend(remoteJid, confirmacao),
    ]);

    const { data: inserted, error } = insertResult;

    if (error || !inserted) {
      const isDupe =
        error?.message?.toLowerCase().includes('duplicate') ||
        error?.code === '23505';
      const reply = isDupe
        ? `ℹ️ Essa mensagem já tinha sido registrada antes.`
        : `⚠️ Erro ao salvar: ${error?.message ?? 'desconhecido'}`;
      await safeSend(remoteJid, reply);
      return NextResponse.json({ ok: true, error: isDupe ? 'duplicate' : 'db' });
    }

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
