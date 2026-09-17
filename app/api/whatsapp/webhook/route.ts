import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { parseMensagem } from '@/modules/financeiro/lib/parser-mensagem';
import { responderConsulta } from '@/modules/financeiro/lib/consultas';
import { executarAcao } from '@/modules/financeiro/lib/acoes';
import { criarCompromisso, resumoCompromissos, listarParcelas, marcarParcelaPaga } from '@/modules/financeiro/lib/compromissos';
import { evolutionEnviarTexto } from '@/lib/evolution';
import { transcreverAudio } from '@/lib/transcricao';
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
  // 0. Validar X-Webhook-Secret (configurado em cada instância Evolution
  // durante o provisionamento). Validação ativada SÓ se WEBHOOK_REQUIRE=1
  // na env, porque algumas versões da Evolution ignoram webhook_custom_headers
  // silenciosamente — fica tudo bloqueado sem o header nunca chegar.
  // Por padrão (sem a flag), aceita qualquer request.
  if (process.env.WEBHOOK_REQUIRE === '1') {
    const expectedSecret = process.env.WEBHOOK_SECRET;
    const got = req.headers.get('x-webhook-secret');
    if (got !== expectedSecret) {
      console.warn('[webhook] secret inválido (got=%s)', got ? 'present' : 'missing');
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

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

  let texto: string =
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.buttonsResponseMessage?.selectedDisplayText ||
    '';
  const remoteJid: string = key?.remoteJid || '';
  const messageId: string = key?.id || '';

  // Nome da instância Evolution que originou o evento. Pode vir em
  // `body.instance`, `body.data.instance` ou `body.data.key.instance`
  // dependendo da versão da Evolution. Resolve pra qualquer um.
  const instanceFromPayload: string | undefined =
    body?.instance ??
    body?.data?.instance ??
    body?.data?.key?.instance ??
    undefined;

  // === ÁUDIO: se for audioMessage com base64, transcreve e usa como texto ===
  // iOS às vezes envia em ephemeralMessage.message.audioMessage; cobre os dois.
  const audioMsg =
    message?.audioMessage ??
    message?.ephemeralMessage?.message?.audioMessage ??
    null;
  if (audioMsg && !texto) {
    const audioBase64: string | undefined = message?.base64 ?? message?.ephemeralMessage?.message?.base64;
    if (audioBase64) {
      const mimeType = audioMsg.mimetype ?? 'audio/ogg';
      console.log(`[webhook] transcrevendo áudio (${audioMsg.seconds ?? '?'}s, ${mimeType})`);
      const ackPromise = safeSend(remoteJid, `🎙️ Transcrevendo…`, instanceFromPayload);
      const transcricao = await transcreverAudio(audioBase64, mimeType);
      if (transcricao) {
        console.log(`[webhook] transcrição: "${transcricao.slice(0, 80)}"`);
        // Substitui o texto pela transcrição
        Object.assign(message, { conversation: transcricao, __transcribed: true });
        // ack da transcrição chegou, deixa ele sair antes
        await ackPromise;
      } else {
        await ackPromise;
        await safeSend(remoteJid, '⚠️ Não consegui transcrever o áudio. Tente enviar em texto.', instanceFromPayload);
        return NextResponse.json({ ok: true, skipped: 'transcribe_failed' });
      }
    } else {
      // Áudio sem base64: webhook não foi configurado com base64:true OU áudio
      // muito antigo. Avisa o usuário pra reenviar o webhook.
      console.warn('[webhook] audioMessage sem base64 — webhook precisa de webhook_base64=true');
      await safeSend(remoteJid, '⚠️ Áudio sem mídia anexada. Reconfigure o webhook com base64:true.', instanceFromPayload);
      return NextResponse.json({ ok: true, skipped: 'no_audio_base64' });
    }
  }

  // Re-lê texto após possível transcrição (audioMessage path pode ter
  // sobrescrito message.conversation com a transcrição).
  if (texto) {
    // já tem texto (texto original), mantém
  } else {
    texto =
      message?.conversation ||
      message?.extendedTextMessage?.text ||
      message?.buttonsResponseMessage?.selectedDisplayText ||
      '';
  }

  if (!texto || !remoteJid) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  // Loop guard: se o texto é uma das nossas próprias respostas (acks/erros
  // que o bot mandou pro grupo), ignora. Sem isso, o bot lê a própria
  // resposta como input, falha no parser, manda "Erro ao interpretar",
  // que vira input de novo → loop infinito. Esse padrão é único o suficiente
  // pra ser seguro como filtro.
  const isOwnBotReply =
    texto.startsWith('⏳') ||
    texto.startsWith('🎙️') ||
    texto.startsWith('✅') ||
    texto.startsWith('⚠️') ||
    texto.startsWith('🤔') ||
    texto.startsWith('ℹ️') ||
    texto.startsWith('🤷');
  if (isOwnBotReply) {
    return NextResponse.json({ ok: true, skipped: 'own_reply' });
  }

  // Em grupo só-com-você (como "Finanças"), todas as mensagens do dono
  // chegam com fromMe=true. Em conversa privada 1:1, mensagens que o
  // próprio número manda (eco do app) também chegam com fromMe=true.
  // Filtramos em qualquer caso onde fromMe=true E não é grupo (porque em
  // grupo, a Evolution repassa mensagens do bot como "fromMe=false" do
  // participant — o loop guard acima já cobre esse caso).
  if (key?.fromMe && !remoteJid.endsWith('@g.us')) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  // 2. Identificar user:
  //    (a) por instance do payload (multi-tenant — caso normal)
  //    (b) fallback por whatsapp_group_jid (legacy Nicolas, instance fixa)
  const supabase = createServiceClient();
  let profile: { id: string } | null = null;

  if (instanceFromPayload) {
    const r = await supabase
      .from('profiles')
      .select('id')
      .eq('evolution_instance_name', instanceFromPayload)
      .maybeSingle();
    profile = r.data;
  }

  if (!profile) {
    const r = await supabase
      .from('profiles')
      .select('id')
      .eq('whatsapp_group_jid', remoteJid)
      .maybeSingle();
    profile = r.data;
  }

  if (!profile) {
    return NextResponse.json({ ok: true, skipped: 'unlinked_group_or_instance' });
  }
  const userId = profile.id;

  // 3. ACK VISUAL em paralelo com parse IA.
  // O ack sai imediatamente (Evolution tem fila interna, entrega em ms),
  // o parser roda em paralelo. Quando o parser terminar, mandamos a
  // confirmação detalhada.
  const ackPromise = safeSend(remoteJid, `⏳ Anotando…`, instanceFromPayload);

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
    await safeSend(remoteJid, '⚠️ Erro ao interpretar. Tente reformular.', instanceFromPayload);
    return NextResponse.json({ ok: true, error: 'parser' });
  }

  // Garante que o "⏳" saiu antes da confirmação
  await ackPromise;

  // 4. Roteamento por intent
  if (parsed.intent === 'outro' || parsed.confidence < 0.6) {
    await safeSend(
      remoteJid,
      '🤔 Não entendi. Pode reformular?\n\nExemplos:\n• "gastei 50 no mercado"\n• "recebi 1500 de freelance"\n• "quanto gastei esse mês?"',
      instanceFromPayload,
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
      safeSend(remoteJid, confirmacao, instanceFromPayload),
    ]);

    const { data: inserted, error } = insertResult;

    if (error || !inserted) {
      const isDupe =
        error?.message?.toLowerCase().includes('duplicate') ||
        error?.code === '23505';
      const reply = isDupe
        ? `ℹ️ Essa mensagem já tinha sido registrada antes.`
        : `⚠️ Erro ao salvar: ${error?.message ?? 'desconhecido'}`;
      await safeSend(remoteJid, reply, instanceFromPayload);
      return NextResponse.json({ ok: true, error: isDupe ? 'duplicate' : 'db' });
    }

    return NextResponse.json({ ok: true, intent: 'lancamento', id: (inserted as FinanceRecord).id });
  }

  if (parsed.intent === 'consulta') {
    const result = await responderConsulta(userId, parsed);
    await safeSend(remoteJid, result.reply, instanceFromPayload);
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
    await safeSend(remoteJid, result.reply, instanceFromPayload);
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
        await safeSend(remoteJid, `🤷 Não achei compromisso com "${desc}".`, instanceFromPayload);
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
        await safeSend(remoteJid, `🤷 Parcela ${num} não encontrada.`, instanceFromPayload);
        return NextResponse.json({ ok: true, intent: 'acao' });
      }
      const result = await marcarParcelaPaga(parc.id, userId);
      await safeSend(remoteJid, result.reply, instanceFromPayload);
      return NextResponse.json({ ok: true, intent: 'acao' });
    }

    const result = await executarAcao(userId, a.acao, a.alvo);
    await safeSend(remoteJid, result.reply, instanceFromPayload);
    return NextResponse.json({ ok: true, intent: 'acao', deleted: result.deleted ?? 0 });
  }

  return NextResponse.json({ ok: true, skipped: true });
}

async function safeSend(destino: string, texto: string, instance?: string) {
  try {
    await evolutionEnviarTexto(destino, texto, 0, 45_000, instance);
  } catch (e) {
    console.error('evolution send error:', e);
  }
}

/**
 * Converte token de data do parser em ISO date (YYYY-MM-DD).
 * Aceita: 'HOJE', 'AMANHA', 'DIA_5'.
 *
 * IMPORTANTE: comparação de datas IGNORA horário (zero hora) pra evitar
 * confusão com fuso ou hora de envio da mensagem.
 */
function tokenParaData(token: string | null | undefined): string | null {
  if (!token) return null;
  const t = token.toUpperCase();

  // Zera o horário pra comparar só a data
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

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
      // Mês atual sempre. Se já passou, joga pro próximo.
      let d = new Date(hoje.getFullYear(), hoje.getMonth(), dia);
      d.setHours(0, 0, 0, 0);
      if (d.getTime() < hoje.getTime()) {
        d = new Date(hoje.getFullYear(), hoje.getMonth() + 1, dia);
      }
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
}
