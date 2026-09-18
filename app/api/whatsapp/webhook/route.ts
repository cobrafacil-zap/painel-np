import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { parseMensagem } from '@/modules/financeiro/lib/parser-mensagem';
import { responderConsulta } from '@/modules/financeiro/lib/consultas';
import { executarAcao } from '@/modules/financeiro/lib/acoes';
import { criarCompromisso, resumoCompromissos, listarParcelas, marcarParcelaPaga } from '@/modules/financeiro/lib/compromissos';
import { parseTarefa } from '@/modules/tarefas/lib/parser-mensagem';
import { criarTarefa, concluirTarefaPorTexto, concluirPorReaction } from '@/modules/tarefas/lib/acoes';
import { mensagemAmbiguidade } from '@/modules/tarefas/lib/mensagens';
import { evolutionEnviarTexto } from '@/lib/evolution';
import { transcreverAudio } from '@/lib/transcricao';
import { tokenParaData, tokenParaHora } from '@/lib/datas';
import { normalizarAcentos } from '@/lib/acentos';
import { formatBRL, todayISO } from '@/lib/utils';
import { getSession, setContext, clearContext } from '@/lib/whatsapp/session';
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

  // === IDENTIFICAÇÃO E FILTRO DE GRUPO — DEVE VIR ANTES DE QUALQUER safeSend ===
  //
  // Por quê isso fica aqui e não depois:
  // 1. Sem essa checagem cedo, qualquer mensagem em qualquer conversa
  //    dispara `safeSend('🎙️ Transcrevendo…')`, que é EXATAMENTE o bug
  //    que apareceu na conversa particular com a Priscila — bot mandou
  //    'Transcrevendo…' em DM.
  // 2. A regra é dura: bot SÓ fala no whatsapp_group_jid salvo no profile.
  //    Em conversa privada 1:1, grupo com amigos, qualquer outro JID
  //    → ignora silenciosamente, sem mandar nada.
  const supabase = createServiceClient();
  let profile: { id: string; whatsapp_group_jid: string | null } | null = null;

  if (instanceFromPayload) {
    const r = await supabase
      .from('profiles')
      .select('id, whatsapp_group_jid')
      .eq('evolution_instance_name', instanceFromPayload)
      .maybeSingle();
    profile = r.data;
  }

  if (!profile) {
    const r = await supabase
      .from('profiles')
      .select('id, whatsapp_group_jid')
      .eq('whatsapp_group_jid', remoteJid)
      .maybeSingle();
    profile = r.data;
  }

  if (!profile) {
    return NextResponse.json({ ok: true, skipped: 'unlinked_group_or_instance' });
  }
  const userId = profile.id;

  if (!profile.whatsapp_group_jid) {
    return NextResponse.json({ ok: true, skipped: 'no_group_configured' });
  }
  if (remoteJid !== profile.whatsapp_group_jid) {
    console.log(
      `[webhook] ignora mensagem fora do grupo (remoteJid=${remoteJid} != ${profile.whatsapp_group_jid})`
    );
    return NextResponse.json({
      ok: true,
      skipped: 'not_target_group',
    });
  }

  // === ÁUDIO: se for audioMessage, transcreve e usa como texto ===
  // Caminho 1 (preferido): webhook veio com `message.base64` (webhookBase64:true).
  // Caminho 2 (fallback): webhookBase64 não está ativo na Evolution 2.3.7
  //   (a config é silenciosamente ignorada nesse servidor). Aí baixamos
  //   via `getBase64FromMediaMessage` que aceita o `message.key.id` e
  //   retorna o conteúdo do áudio já descriptografado.
  const audioMsg =
    message?.audioMessage ??
    message?.ephemeralMessage?.message?.audioMessage ??
    null;
  if (audioMsg && !texto) {
    let audioBase64: string | undefined =
      message?.base64 ?? message?.ephemeralMessage?.message?.base64;

    // Caminho 2: busca o base64 via API da Evolution
    if (!audioBase64 && messageId && instanceFromPayload) {
      try {
        console.log(`[webhook] baixando áudio via getBase64FromMediaMessage (id=${messageId})`);
        const cfg = await import('@/lib/evolution').then((m) =>
          m.evolutionGlobalConfig()
        );
        const r = await fetch(
          `${cfg.baseUrl}/chat/getBase64FromMediaMessage/${instanceFromPayload}`,
          {
            method: 'POST',
            headers: { apikey: cfg.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: { key: { id: messageId }, messageType: 'audioMessage' },
            }),
            signal: AbortSignal.timeout(30_000),
          }
        );
        if (r.ok) {
          const j = (await r.json()) as { base64?: string };
          audioBase64 = j.base64;
        } else {
          console.warn(`[webhook] getBase64FromMediaMessage HTTP ${r.status}`);
        }
      } catch (e) {
        console.error('[webhook] erro ao baixar áudio:', e);
      }
    }

    if (audioBase64) {
      const mimeType = audioMsg.mimetype ?? 'audio/ogg';
      console.log(`[webhook] transcrevendo áudio (${audioMsg.seconds ?? '?'}s, ${mimeType})`);
      const ackPromise = safeSend(remoteJid, `🎙️ Transcrevendo…`, instanceFromPayload);
      const transcricao = await transcreverAudio(audioBase64, mimeType);
      if (transcricao) {
        console.log(`[webhook] transcrição: "${transcricao.slice(0, 80)}"`);
        Object.assign(message, { conversation: transcricao, __transcribed: true });
        await ackPromise;
      } else {
        await ackPromise;
        await safeSend(remoteJid, '⚠️ Não consegui transcrever o áudio. Tente enviar em texto.', instanceFromPayload);
        return NextResponse.json({ ok: true, skipped: 'transcribe_failed' });
      }
    } else {
      console.warn('[webhook] audioMessage sem base64 (webhook + fallback falharam)');
      await safeSend(remoteJid, '⚠️ Não consegui baixar o áudio. Tente reenviar.', instanceFromPayload);
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

  // === HANDLER DE REAÇÃO ✅ (módulo Tarefas) ===
  // Quando alguém reage com ✅ à msg de confirmação de uma tarefa, o
  // webhook recebe um evento com `message.reactionMessage` apontando
  // pra msg original. Marcamos a tarefa correspondente como concluída
  // e respondemos com confirmação no grupo.
  const reaction =
    message?.reactionMessage ??
    message?.ephemeralMessage?.message?.reactionMessage ??
    null;
  if (reaction) {
    const emoji = reaction.text;
    const reactedToId = reaction.key?.id;
    if (emoji === '✅' && reactedToId) {
      const result = await concluirPorReaction(reactedToId);
      if (result.ok && result.reply) {
        await safeSend(remoteJid, result.reply, instanceFromPayload);
        return NextResponse.json({ ok: true, intent: 'reacao_concluir' });
      }
      // reação que não casa com nenhuma tarefa → ignora silenciosamente
      return NextResponse.json({ ok: true, skipped: 'reaction_no_match' });
    }
    // outras reações → ignora
    return NextResponse.json({ ok: true, skipped: 'reaction_other' });
  }

  // === ACIONAR TAREFA POR TEXTO ("concluí X", "feito Y") ===
  // Regex local: detecta frases curtas com verbo de conclusão + trecho
  // do título. Se bater, chama concluirTarefaPorTexto e responde.
  const tlConcluir = texto.trim().toLowerCase();
  const concluMatch = tlConcluir.match(/^(conclu[íi]|feito|pronto|terminei|finalizei|ok|done)\s+(.+)$/i);
  if (concluMatch) {
    const trecho = concluMatch[2].trim();
    // Só dispara se o trecho tiver pelo menos 3 chars (evita "feito" solto)
    if (trecho.length >= 3) {
      const result = await concluirTarefaPorTexto(userId, trecho);
      await safeSend(remoteJid, result.reply || '🤷 Não entendi qual tarefa.', instanceFromPayload);
      return NextResponse.json({ ok: true, intent: 'concluir_tarefa_texto' });
    }
  }

  // 3. ACK VISUAL em paralelo com parse IA.
  // O ack sai imediatamente (Evolution tem fila interna, entrega em ms),
  // o parser roda em paralelo. Quando o parser terminar, mandamos a
  // confirmação detalhada.
  const ackPromise = safeSend(remoteJid, `⏳ Anotando…`, instanceFromPayload);

  // === CLASSIFICADOR DE MÓDULO (regex local, custo zero) ===
  // Decide qual parser chamar: financeiro (existente) ou tarefas (novo).
  const modulo = classificarModulo(texto);
  console.log(`[webhook] classificarModulo=${modulo}`);

  let parsed: import('@/modules/financeiro/lib/parser-mensagem').ParsedIntent | import('@/modules/tarefas/lib/parser-mensagem').TarefaParsedIntent;
  try {
    if (modulo === 'tarefas') {
      parsed = await Promise.race([
        parseTarefa(texto),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('parser-tarefa timeout')), 25_000)
        ),
      ]);
    } else if (modulo === 'financeiro') {
      parsed = await Promise.race([
        parseMensagem(texto, { userId }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('parser timeout')), 25_000)
        ),
      ]);
    } else {
      // 'outro' → cai pro financeiro (comportamento legado cobre cumprimentos,
      // perguntas, etc.). Se for tarefa_ambigua, o financeiro devolve intent
      // 'outro' e respondemos com a mensagem padrão.
      parsed = await Promise.race([
        parseMensagem(texto, { userId }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('parser timeout')), 25_000)
        ),
      ]);
    }
  } catch (e: any) {
    console.error('parser error:', e);
    await ackPromise;
    await safeSend(remoteJid, '⚠️ Erro ao interpretar. Tente reformular.', instanceFromPayload);
    return NextResponse.json({ ok: true, error: 'parser' });
  }

  // Garante que o "⏳" saiu antes da confirmação
  await ackPromise;

  // 4. Roteamento por intent
  // === Tarefas ===
  if (parsed.intent === 'tarefa') {
    const t = parsed as Extract<typeof parsed, { intent: 'tarefa' }>;
    const dataPrazo = tokenParaData(t.data_token);
    if (!dataPrazo) {
      // Sem data reconhecível → pergunta
      await safeSend(remoteJid, mensagemAmbiguidade('sem_data'), instanceFromPayload);
      return NextResponse.json({ ok: true, intent: 'tarefa_ambigua', motivo: 'sem_data' });
    }
    const horaPrazo = t.hora_token ? tokenParaHora(t.hora_token) : null;

    // Cria tarefa + manda confirmação. Em paralelo: manda confirmação,
    // grava tarefa, agenda lembretes.
    const result = await criarTarefa(
      userId,
      {
        texto_original: texto,
        titulo: t.titulo,
        descricao: t.descricao,
        data_prazo: dataPrazo,
        hora_prazo: horaPrazo,
        tipo: horaPrazo ? 'compromisso' : 'prazo',
        categoria: t.categoria,
        prioridade: t.prioridade,
        recorrencia: t.recorrencia,
        source: 'whatsapp',
        source_message_id: messageId,
      },
      // Não passa confirmMessageId aqui — safeSend ainda não rodou.
      undefined
    );

    // Mensagem de confirmação (curta, com data/lembretes). Capturamos o
    // ID da msg pra gravar em tarefas.confirm_message_id — é esse ID
    // que o handler de reação ✅ busca pra concluir a tarefa.
    const sent = await safeSend(remoteJid, result.reply, instanceFromPayload);
    if (result.ok && result.id && sent.id) {
      try {
        await supabase
          .from('tarefas')
          .update({ confirm_message_id: sent.id })
          .eq('id', result.id)
          .eq('user_id', userId);
      } catch (e) {
        console.warn('[webhook] não gravou confirm_message_id:', e);
      }
    }

    return NextResponse.json({ ok: true, intent: 'tarefa', id: result.id });
  }

  if (parsed.intent === 'tarefa_ambigua') {
    const t = parsed as Extract<typeof parsed, { intent: 'tarefa_ambigua' }>;
    await safeSend(remoteJid, mensagemAmbiguidade(t.motivo), instanceFromPayload);
    return NextResponse.json({ ok: true, intent: 'tarefa_ambigua', motivo: t.motivo });
  }

  // === FOLLOW-UP com contexto (#2) ===
  // Se a mensagem caiu em 'outro' (frase curta sem verbo claro), checa se
  // existe uma consulta recente na sessão. Se sim, injeta como contexto pro
  // Groq re-interpretar a frase como refinamento ("e mês passado?",
  // "que dia foi?", "e dividido por categoria?").
  if ((parsed.intent === 'outro' || parsed.confidence < 0.6) && instanceFromPayload) {
    const sess = await getSession(userId, remoteJid, instanceFromPayload);
    if (sess.lastQuery && texto.trim().length <= 60) {
      const enriched = `Contexto da última pergunta do usuário: ele acabou de perguntar "${sess.lastQuery.tipo}" no período "${sess.lastQuery.periodo}"${sess.lastQuery.categoriaLabel ? ` filtrando por "${sess.lastQuery.categoriaLabel}"` : ''}. A mensagem de agora dele é: "${texto}".\n\nSe a mensagem nova for um refinamento da última pergunta (mudar período, dividir por categoria, etc), retorne intent="consulta" reaproveitando os campos relevantes. Caso contrário, retorne intent="outro".`;
      const reParsed = await parseMensagem(enriched);
      if (reParsed.intent !== 'outro' && reParsed.confidence >= 0.6) {
        parsed = reParsed;
        // Re-roteia pelo handler de consulta
        if (parsed.intent === 'consulta') {
          const result = await responderConsulta(userId, parsed as Extract<typeof parsed, { intent: 'consulta' }>, {
            remoteJid,
            instanceName: instanceFromPayload,
          });
          await safeSend(remoteJid, result.reply, instanceFromPayload);
          return NextResponse.json({ ok: true, intent: 'consulta', followup: true });
        }
      }
    }
  }

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
    const result = await responderConsulta(userId, parsed, {
      remoteJid,
      instanceName: instanceFromPayload ?? '',
    });
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
        category: c.category ?? null,
      },
      messageId
    );
    await safeSend(remoteJid, result.reply, instanceFromPayload);
    return NextResponse.json({ ok: true, intent: 'compromisso', id: result.id });
  }

  if (parsed.intent === 'acao') {
    const a = parsed as Extract<typeof parsed, { intent: 'acao' }>;

    // "pagar_conta" tem tratamento especial (não passa pelo acoes.ts): busca
    // o compromisso pendente (parcela 1, não paga) que case com a descrição
    // (ex: "luz") e marca como pago. Diferente de pagar_parcela, que
    // exige número explícito ("parcela 2 da mãe").
    if (a.acao === 'pagar_conta' && a.alvo) {
      const supabase = createServiceClient();
      // Procura o compromisso mais recente que case com a descrição e tenha
      // pelo menos uma parcela pendente. Ordena por created_at desc pra
      // pegar o mais recente.
      const { data: comp } = await supabase
        .from('compromissos')
        .select('id, descricao, valor_total')
        .eq('user_id', userId)
        .eq('tipo', 'pagar')
        .ilike('descricao', `%${a.alvo}%`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!comp) {
        await safeSend(
          remoteJid,
          `🤷 Não achei compromisso pendente com "${a.alvo}". Crie um antes com "tenho conta de ${a.alvo} N reais".`,
          instanceFromPayload,
        );
        return NextResponse.json({ ok: true, intent: 'acao' });
      }
      // Pega a primeira parcela pendente (menor numero sem data_pagamento)
      const { data: parc } = await supabase
        .from('compromisso_parcelas')
        .select('id, numero')
        .eq('user_id', userId)
        .eq('compromisso_id', comp.id)
        .is('data_pagamento', null)
        .order('numero', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!parc) {
        await safeSend(
          remoteJid,
          `✅ A conta de ${comp.descricao} já está toda paga.`,
          instanceFromPayload,
        );
        return NextResponse.json({ ok: true, intent: 'acao' });
      }
      const result = await marcarParcelaPaga(parc.id, userId);
      await safeSend(remoteJid, result.reply, instanceFromPayload);
      return NextResponse.json({ ok: true, intent: 'acao' });
    }

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

async function safeSend(
  destino: string,
  texto: string,
  instance?: string
): Promise<{ id: string | null }> {
  try {
    const r = await evolutionEnviarTexto(destino, texto, 0, 45_000, instance);
    return { id: r.id || null };
  } catch (e) {
    console.error('evolution send error:', e);
    return { id: null };
  }
}

/**
 * Classifica a mensagem em qual módulo deve processá-la.
 * Regex local (custo zero, sem IA). Heurística:
 *  - Verbo financeiro COM valor monetário → financeiro.
 *  - Verbo financeiro SEM marcador de tarefa → financeiro.
 *  - Marcador forte de tarefa SEM verbo financeiro → tarefas.
 *  - Marcador de tarefa + verbo financeiro sem valor → AMBÍGUO (deixa
 *    pro parseTarefa decidir via motivo=financeiro_ou_tarefa).
 *  - Mensagem só com data/hora (sem verbo) → tarefas (é claramente um
 *    lembrete/compromisso: "Amanhã às 14h", "sexta reunião" sem verbo,
 *    "amanhã dentista"). Sem isso, cai em "outro" e o financeiro dá
 *    timeout ou devolve intent=outro.
 *  - Sem marcadores fortes → outro.
 */
function classificarModulo(texto: string): 'financeiro' | 'tarefas' | 'outro' {
  const t = normalizarAcentos(texto.toLowerCase()).trim();
  if (!t) return 'outro';

  const temVerboFinanceiro =
    /\b(gastei|gastar|comprei|comprar|sac[ou]ei|debit[ou]|custei|paguei|pagar|pago|recebi|receber|ganhei|ganhar|peguei|tirei|emprestei|faturei|saiu|custou|entrou|caiu|depositou)\b/i.test(t);

  const temValorMonetario =
    /r\$\s*\d|\b\d{1,3}(?:\.\d{3})+|\b\d+[,\.]\d{2}\b|\b\d{3,}\b/.test(t);

  const temMarcadorTarefa =
    /\b(tenho\s+que|preciso|vou\s+(?:fazer|ir|ligar|entregar|marcar|lembrar)|lembrar|lembrete|reuni[ãa]o|entregar|ligar|anotar|anota|agendar|marcar|campanha|lembrete)\b/i.test(
      t
    );

  // Tem alguma coisa que parece data (sem verbo): "Amanhã às 10h",
  // "sexta 14h", "amanhã dentista", "amanhã" puro.
  const temDataRelativa =
    /\b(hoje|amanh[ãa]|semana\s+que\s+vem|m[êe]s\s+que\s+vem|fim\s+(?:do|d[eo])\s+m[êe]s|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo|daqui\s+a\s+\d+\s+dias?|pr[óo]ximo\s+dia\s+\d+|\bdia\s+\d{1,2})\b/i.test(
      t
    );
  // Tem hora explícita: "14h", "14:30", "às 10", "de manhã", "de tarde", "de noite".
  const temHoraExplicita =
    /\b(?:[àa]s?\s+\d{1,2}(?:h(?:\d{2})?|:\d{2})|de\s+(?:manh[ãa]|tarde|noite)|\d{1,2}h(?:\d{2})?|\d{1,2}:\d{2})\b/i.test(
      t
    );

  // Financeiro forte: verbo financeiro + valor
  if (temVerboFinanceiro && temValorMonetario) return 'financeiro';
  // Financeiro sem tarefa: "paguei a conta" sem "fazer reunião"
  if (temVerboFinanceiro && !temMarcadorTarefa) return 'financeiro';
  // Tarefa forte: marcador de tarefa sem verbo financeiro
  if (temMarcadorTarefa && !temVerboFinanceiro) return 'tarefas';
  // Ambíguo: marcador de tarefa + verbo financeiro sem valor → tarefas
  // (parseTarefa vai detectar como tarefa_ambigua motivo=financeiro_ou_tarefa)
  if (temMarcadorTarefa && temVerboFinanceiro && !temValorMonetario) return 'tarefas';
  // Sem verbo mas com (data + hora) ou só data explícita → tarefas.
  // Frases como "Amanhã às 10hrs da manhã", "sexta 14h", "amanhã dentista"
  // são claramente lembretes/compromissos, não financeiro.
  // Só data pura sem hora também entra (vira tarefa tipo "prazo").
  if ((temDataRelativa || temHoraExplicita) && !temVerboFinanceiro) return 'tarefas';
  // Sem marcadores fortes
  return 'outro';
}
