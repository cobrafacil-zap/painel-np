import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { parseMensagem } from '@/modules/financeiro/lib/parser-mensagem';
import { responderConsulta } from '@/modules/financeiro/lib/consultas';
import { executarAcao } from '@/modules/financeiro/lib/acoes';
import { criarCompromisso, resumoCompromissos, listarParcelas, marcarParcelaPaga } from '@/modules/financeiro/lib/compromissos';
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

  // NOTA: em grupo só-com-você (como "Finanças"), todas as mensagens têm
  // fromMe=true porque o único humano É você. NÃO filtramos by fromMe aqui.
  // Se a Evolution entregar mensagens de outros humanos no futuro, ajustar
  // comparando o `participant` contra o JID do dono do profile.
  if (key?.fromMe && !remoteJid.endsWith('@g.us')) {
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

  if (parsed.intent === 'compromisso') {
    const c = parsed as Extract<typeof parsed, { intent: 'compromisso' }>;
    const dataVenc = tokenParaData(c.data_primeira);
    const result = await criarCompromisso(
      userId,
      {
        tipo: c.tipo,
        descricao: c.descricao,
        valor_total: c.valor_total,
        data_vencimento: dataVenc,
        total_parcelas: c.total_parcelas,
        recorrencia: c.recorrencia,
      },
      messageId
    );
    await safeSend(remoteJid, result.reply);
    return NextResponse.json({ ok: true, intent: 'compromisso', id: result.id });
  }

  if (parsed.intent === 'acao') {
    const a = parsed as Extract<typeof parsed, { intent: 'acao' }>;

    // "pagar_parcela" tem tratamento especial (não passa pelo acoes.ts)
    if (a.acao === 'pagar_parcela' && a.alvo) {
      const [desc, numStr] = a.alvo.split(':');
      const num = parseInt(numStr ?? '1', 10);
      const supabase = createServiceClient();
      // Encontra a parcela pela descrição + número
      const { data: comp } = await supabase
        .from('compromissos')
        .select('id')
        .eq('user_id', userId)
        .ilike('descricao', `%${desc}%`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!comp) {
        await safeSend(remoteJid, `🤷 Não achei compromisso com "${desc}".`);
        return NextResponse.json({ ok: true, intent: 'acao' });
      }
      const { data: parc } = await supabase
        .from('compromisso_parcelas')
        .select('id')
        .eq('user_id', userId)
        .eq('compromisso_id', comp.id)
        .eq('numero', num)
        .maybeSingle();
      if (!parc) {
        await safeSend(remoteJid, `🤷 Parcela ${num} não encontrada.`);
        return NextResponse.json({ ok: true, intent: 'acao' });
      }
      const result = await marcarParcelaPaga(parc.id, userId);
      await safeSend(remoteJid, result.reply);
      return NextResponse.json({ ok: true, intent: 'acao' });
    }

    const result = await executarAcao(userId, a.acao, a.alvo);
    await safeSend(remoteJid, result.reply);
    return NextResponse.json({ ok: true, intent: 'acao', deleted: result.deleted ?? 0 });
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

/**
 * Converte token de data do parser em ISO date (YYYY-MM-DD).
 * Aceita: 'HOJE', 'AMANHA', 'DIA_5' (próximo dia 5 do mês), null.
 */
function tokenParaData(token: string | null | undefined): string | null {
  if (!token) return null;
  const t = token.toUpperCase();
  const hoje = new Date();
  if (t === 'HOJE') return hoje.toISOString().slice(0, 10);
  if (t === 'AMANHA') {
    const amanha = new Date(hoje);
    amanha.setDate(amanha.getDate() + 1);
    return amanha.toISOString().slice(0, 10);
  }
  const m = t.match(/^DIA_(\d{1,2})$/);
  if (m) {
    const dia = parseInt(m[1], 10);
    if (dia >= 1 && dia <= 31) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth(), dia);
      // Se já passou esse dia no mês, joga pro próximo mês
      if (d < hoje) d.setMonth(d.getMonth() + 1);
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
}
