import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { parseMensagem } from '@/modules/financeiro/lib/parser-mensagem';
import { responderConsulta } from '@/modules/financeiro/lib/consultas';
import { executarAcao } from '@/modules/financeiro/lib/acoes';
import { criarCompromisso, resumoCompromissos, listarParcelas, marcarParcelaPaga } from '@/modules/financeiro/lib/compromissos';
import { setOrcamento, getOrcamento, deleteOrcamento } from '@/modules/financeiro/lib/orcamentos';
import {
  setMetaDiaria,
  getMetaDiaria,
  deleteMetaDiaria,
  getGastoHoje,
  formatarIndicadorMeta,
  checarAvisoMetaDiaria,
} from '@/lib/financeiro/meta-diaria';
import { parseTarefa } from '@/modules/tarefas/lib/parser-mensagem';
import { criarTarefa, concluirTarefaPorTexto, concluirPorReaction } from '@/modules/tarefas/lib/acoes';
import { mensagemAmbiguidade } from '@/modules/tarefas/lib/mensagens';
import { evolutionEnviarTexto } from '@/lib/evolution';
import { transcreverAudio } from '@/lib/transcricao';
import { tokenParaData, tokenParaHora } from '@/lib/datas';
import { normalizarAcentos } from '@/lib/acentos';
import { formatBRL, todayISO } from '@/lib/utils';
import { getSession, setContext, clearContext } from '@/lib/whatsapp/session';
import { detectarDuplicata, formatarMensagemDuplicata } from '@/lib/financeiro/dedup';
import { extrairEntidades } from '@/lib/nlp/entities';
import { getOrCompute as parserCacheGetOrCompute } from '@/lib/parser-cache';
import { autoCategorize } from '@/lib/financeiro/categorias';
import { upsertMetaLonga, listMetasLongas, atualizarValorGuardado, simularMetaLonga } from '@/lib/financeiro/metas-longas';
import { logStage, logError } from '@/lib/log';
import { recordParserStage } from '@/lib/parser-stats';
import {
  uploadAudio,
  saveAudioMessage,
  updateTranscription,
  updateSummary,
} from '@/lib/audio-storage';
import { summarizeAudio } from '@/lib/audio-summary';
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
      const duration = typeof audioMsg.seconds === 'number' ? audioMsg.seconds : null;
      logStage('webhook_audio_recebido', undefined, {
        mime: mimeType,
        secs: duration,
        msgId: messageId,
      });

      // 1. Upload pro Storage + INSERT inicial em `messages` (best-effort;
      //    se falhar ou passar do limite de tamanho, ainda tentamos
      //    transcrever pra não bloquear o fluxo — transcrição+sumário
      //    ficam preservados mesmo sem o arquivo).
      let audioRowId: string | null = null;
      try {
        const uploaded = await uploadAudio(audioBase64, mimeType, userId, messageId);
        if (uploaded && !uploaded.skipped) {
          const saved = await saveAudioMessage({
            userId,
            messageIdWhatsapp: messageId,
            remoteJid,
            instanceName: instanceFromPayload ?? null,
            storagePath: uploaded.storage_path,
            mimeType: uploaded.mime_type,
            fileSizeBytes: uploaded.file_size_bytes,
            durationSeconds: duration,
          });
          audioRowId = saved?.id ?? null;
        } else if (uploaded?.skipped) {
          // Áudio pulou o upload (muito grande). Salva row com path=null
          // — transcrição+sumário ficam, arquivo não.
          const saved = await saveAudioMessage({
            userId,
            messageIdWhatsapp: messageId,
            remoteJid,
            instanceName: instanceFromPayload ?? null,
            storagePath: null,
            mimeType: mimeType,
            fileSizeBytes: uploaded.file_size_bytes,
            durationSeconds: duration,
          });
          audioRowId = saved?.id ?? null;
        }
      } catch (e) {
        logError('audio_persist_pre_transcribe', e, { msgId: messageId });
      }

      // 2. Transcreve via Whisper
      const transcricao = await transcreverAudio(audioBase64, mimeType);

      if (transcricao) {
        logStage('webhook_audio_transcrito', undefined, {
          len: transcricao.length,
          msgId: messageId,
        });

        // 3. UPDATE em `messages` com a transcrição (best-effort; falha
        //    aqui NÃO bloqueia o pipeline do webhook).
        if (audioRowId) {
          void updateTranscription(audioRowId, transcricao, 0.85);
        }

        // 4. Sumário por IA inline (best-effort, tolerante a falha).
        //    Roda em paralelo com o pipeline principal — não bloqueia.
        if (audioRowId) {
          void (async () => {
            const summary = await summarizeAudio(transcricao);
            if (summary) {
              await updateSummary(audioRowId!, summary.summary, summary.topics, summary.entities);
              logStage('audio_summary_done', undefined, { msgId: messageId });
            }
          })();
        }

        Object.assign(message, { conversation: transcricao, __transcribed: true });
      } else {
        // Transcrição falhou — mantém o áudio salvo (sumário vai ficar
        // pendente) mas avisa o user.
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

  // Loop guard: se o texto é uma das nossas próprias respostas (confirmações
  // que o bot mandou pro grupo), ignora. Sem isso, o bot lê a própria
  // resposta como input, falha no parser, manda "Erro ao interpretar",
  // que vira input de novo → loop infinito. Esse padrão é único o suficiente
  // pra ser seguro como filtro.
  const isOwnBotReply =
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
      const result = await concluirPorReaction(reactedToId, {
        userId,
        remoteJid,
        instanceName: instanceFromPayload,
      });
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

  // === RESPOSTA A PROMPT PENDENTE (#3 dedup, #5 undo) ===
  // Se o usuário respondeu "sim"/"não" e tem um pendingPrompt recente,
  // executa a ação guardada.
  if (instanceFromPayload && texto.trim().length <= 20) {
    const sess = await getSession(userId, remoteJid, instanceFromPayload);
    const pk = sess.pendingPrompt?.kind;
    const resp = texto.trim().toLowerCase();

    if (pk === 'dedup_confirm') {
      if (/^(sim|s|yes|y|confirma|confere|pode\s+registrar|registra|e)$/i.test(resp)) {
        const payload = sess.pendingPrompt!.payload as any;
        const { error } = await supabase.from('records').insert({
          user_id: userId,
          module_id: 'financeiro',
          type: 'gasto',
          amount: payload.amount,
          category: payload.category,
          description: payload.description,
          payment_method: payload.payment_method,
          occurred_at: payload.occurred_at ?? todayISO(),
          source: 'whatsapp',
          source_message_id: messageId,
          metadata: { remote_jid: remoteJid, dedup_confirmed: true },
        });
        await setContext(userId, remoteJid, instanceFromPayload, { pendingPrompt: undefined } as any);
        if (error) {
          await safeSend(remoteJid, `⚠️ Erro ao salvar: ${error.message}`, instanceFromPayload);
        } else {
          await safeSend(remoteJid, `✅ Registrado (era outro mesmo).`, instanceFromPayload);
        }
        return NextResponse.json({ ok: true, intent: 'dedup_confirmed' });
      }
      if (/^(n[ãa]o|nao|n|no|cancela|cancelar|ignora|esquece)$/i.test(resp)) {
        await setContext(userId, remoteJid, instanceFromPayload, { pendingPrompt: undefined } as any);
        await safeSend(remoteJid, `👍 Beleza, não registrei.`, instanceFromPayload);
        return NextResponse.json({ ok: true, intent: 'dedup_cancelled' });
      }
    }

    if (pk === 'delete_confirm') {
      const payload = sess.pendingPrompt!.payload as {
        acao: 'apagar_categoria';
        alvo: string;
        count: number;
        totalAmount: number;
      };
      if (/^(sim|s|yes|y|confirma|confere|pode|apaga)$/i.test(resp)) {
        // Apaga e gera snapshots pra undo
        const { data: toDelete } = await supabase
          .from('records')
          .select('id, type, amount, category, description, occurred_at, payment_method, module_id, source')
          .eq('user_id', userId)
          .eq('module_id', 'financeiro')
          .eq('category', payload.alvo);
        const { error } = await supabase
          .from('records')
          .delete()
          .eq('user_id', userId)
          .eq('module_id', 'financeiro')
          .eq('category', payload.alvo);
        if (error) {
          await safeSend(remoteJid, `⚠️ Erro ao apagar: ${error.message}`, instanceFromPayload);
          return NextResponse.json({ ok: true, intent: 'acao', error: 'db' });
        }
        const snapshots = (toDelete ?? []).map(({ id: _id, ...rest }) => rest);
        await setContext(userId, remoteJid, instanceFromPayload, {
          pendingPrompt: undefined,
          lastDeletedRecord: {
            record: snapshots[0] ?? null,
            snapshots,
            ts: new Date().toISOString(),
          },
        } as any);
        await safeSend(
          remoteJid,
          `🗑️ ${payload.count} lançamentos de "${payload.alvo}" apagados.\nSe arrependeu, responde "desfazer" em 30min.`,
          instanceFromPayload,
        );
        return NextResponse.json({ ok: true, intent: 'acao', deleted: payload.count });
      }
      if (/^(n[ãa]o|nao|n|no|cancela|cancelar|esquece)$/i.test(resp)) {
        await setContext(userId, remoteJid, instanceFromPayload, { pendingPrompt: undefined } as any);
        await safeSend(remoteJid, `👍 Beleza, não apaguei nada.`, instanceFromPayload);
        return NextResponse.json({ ok: true, intent: 'acao', cancelled: true });
      }
    }
  }

  // === DESFAZER delete (#5) ===
  // Usuário pode responder "desfazer" / "volta" / "restaura" logo após
  // apagar 1 ou vários registros. O snapshot fica em `lastDeletedRecord`
  // por 30min (TTL da sessão).
  if (instanceFromPayload && /^desfazer|volta|restaura|undo|desfiz|cancelar/i.test(texto.trim())) {
    const sess = await getSession(userId, remoteJid, instanceFromPayload);
    const ld = sess.lastDeletedRecord;
    if (ld) {
      const snapshots = (ld as any).snapshots ?? ((ld as any).record ? [(ld as any).record] : []);
      if (snapshots.length === 0) {
        await safeSend(remoteJid, `🤷 Não tenho nada pra restaurar.`, instanceFromPayload);
        return NextResponse.json({ ok: true, intent: 'undo_nothing' });
      }
      const rows = snapshots.map((s: any) => ({
        user_id: userId,
        module_id: s.module_id ?? 'financeiro',
        type: s.type,
        amount: s.amount,
        category: s.category,
        description: s.description,
        payment_method: s.payment_method,
        occurred_at: s.occurred_at ?? todayISO(),
        source: s.source ?? 'whatsapp',
        metadata: { restored_from_undo: true, original_deleted_at: ld.ts },
      }));
      const { error } = await supabase.from('records').insert(rows);
      await setContext(userId, remoteJid, instanceFromPayload, { lastDeletedRecord: undefined } as any);
      if (error) {
        await safeSend(remoteJid, `⚠️ Erro ao restaurar: ${error.message}`, instanceFromPayload);
      } else {
        await safeSend(
          remoteJid,
          `↩️ Pronto, restaurei ${rows.length} registro${rows.length > 1 ? 's' : ''}.`,
          instanceFromPayload,
        );
      }
      return NextResponse.json({ ok: true, intent: 'undo_done', restored: rows.length });
    }
  }

  // 3. Sem ack visual — o bot só fala a confirmação final com a tarefa
  // já feita. Sem "⏳ Anotando…" pra reduzir chance de duplo-disparo
  // e ruído no grupo.

  // === CLASSIFICADOR DE MÓDULO (regex local, custo zero) ===
  // Decide qual parser chamar: financeiro (existente) ou tarefas (novo).
  const modulo = classificarModulo(texto);
  logStage('webhook_classify', undefined, { modulo });

  // Variáveis separadas por módulo — os tipos dos dois parsers não
  // podem ser unificados (TarefaParsedIntent não estende ParsedIntent
  // do financeiro). O union abaixo serve só pra roteamento; cada ramo
  // faz seu próprio narrowing.
  let parsedFinanceiro: import('@/modules/financeiro/lib/parser-mensagem').ParsedIntent | undefined;
  let parsedTarefa: import('@/modules/tarefas/lib/parser-mensagem').TarefaParsedIntent | undefined;
  let parsedIntent: string = 'outro';
  let parsedConfidence: number = 0;
  try {
    const t0 = Date.now();
    if (modulo === 'tarefas') {
      const tarefaResult = await parserCacheGetOrCompute(texto, () =>
        Promise.race([
          parseTarefa(texto, { userId }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('parser-tarefa timeout')), 25_000)
          ),
        ])
      );
      parsedTarefa = tarefaResult;
      parsedIntent = tarefaResult.intent;
      parsedConfidence = tarefaResult.confidence;
    } else {
      // financeiro OU outro — passa pelo cache
      parsedFinanceiro = await parserCacheGetOrCompute(texto, () =>
        Promise.race([
          parseMensagem(texto, { userId }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('parser timeout')), 25_000)
          ),
        ])
      );
      parsedIntent = parsedFinanceiro.intent;
      parsedConfidence = parsedFinanceiro.confidence;
    }
    logStage('webhook_parse_done', Date.now() - t0, {
      intent: parsedIntent,
      confidence: parsedConfidence,
      modulo,
    });
    recordParserStage('parser_ok');
  } catch (e: any) {
    const isTimeout = e?.message?.includes('timeout') || e?.name === 'AbortError';
    logError('webhook_parse', e, { isTimeout });

    if (isTimeout) {
      recordParserStage('parser_timeout');
      await safeSend(
        remoteJid,
        '⏱️ Demorei pra pensar. Tenta de novo com uma frase mais curta.',
        instanceFromPayload,
      );
      return NextResponse.json({ ok: true, error: 'parser_timeout' });
    }

    // Erro técnico (campo __error injetado pelo parser-mensagem.ts)
    const isTechnical =
      (parsedFinanceiro as any)?.__error === 'technical' ||
      (parsedTarefa as any)?.__error === 'technical';
    if (isTechnical) {
      recordParserStage('parser_error');
      await safeSend(
        remoteJid,
        '⚠️ Erro técnico ao interpretar. Já anotei pra investigar.',
        instanceFromPayload,
      );
      return NextResponse.json({ ok: true, error: 'parser_technical' });
    }

    recordParserStage('parser_error');
    await safeSend(remoteJid, '⚠️ Erro ao interpretar. Tente reformular.', instanceFromPayload);
    return NextResponse.json({ ok: true, error: 'parser' });
  }

  // Alias pra legibilidade no switch abaixo. `let` porque o bloco de
  // refinamento (linha 593) reatribui quando o user refina uma consulta.
  let parsed: ParsedIntentTarefaOuFinanceiro =
    (parsedFinanceiro as ParsedIntentTarefaOuFinanceiro | undefined) ??
    (parsedTarefa as ParsedIntentTarefaOuFinanceiro | undefined) ??
    ({ intent: 'outro', confidence: 0 } as ParsedIntentTarefaOuFinanceiro);

  type ParsedIntentTarefaOuFinanceiro =
    | import('@/modules/financeiro/lib/parser-mensagem').ParsedIntent
    | import('@/modules/tarefas/lib/parser-mensagem').TarefaParsedIntent;

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
      // #5: também grava na sessão pra conclusão por reação contextual
      if (instanceFromPayload) {
        void setContext(userId, remoteJid, instanceFromPayload, {
          lastBotMessageId: sent.id,
          lastCreatedTarefaId: result.id,
        });
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
  if ((parsed.intent === 'outro' || parsed.confidence < 0.75) && instanceFromPayload) {
    const sess = await getSession(userId, remoteJid, instanceFromPayload);
    if (sess.lastQuery && texto.trim().length <= 60) {
      const enriched = `Contexto da última pergunta do usuário: ele acabou de perguntar "${sess.lastQuery.tipo}" no período "${sess.lastQuery.periodo}"${sess.lastQuery.categoriaLabel ? ` filtrando por "${sess.lastQuery.categoriaLabel}"` : ''}. A mensagem de agora dele é: "${texto}".\n\nSe a mensagem nova for um refinamento da última pergunta (mudar período, dividir por categoria, etc), retorne intent="consulta" reaproveitando os campos relevantes. Caso contrário, retorne intent="outro".`;
      const reParsed = await parseMensagem(enriched);
      if (reParsed.intent !== 'outro' && reParsed.confidence >= 0.75) {
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

  if (parsed.intent === 'outro' || parsed.confidence < 0.75) {
    // Detector de meta longa (#overhaul metas-largas): frases tipo
    // "quero juntar 100k em 5 anos" caem aqui antes de cair no
    // fallthrough. Regex próprio pra evitar custo de LLM extra.
    const metaLongaParsed = parseFraseMetaLonga(texto);
    if (metaLongaParsed) {
      try {
        const meta = await upsertMetaLonga({
          userId,
          nome: metaLongaParsed.nome,
          valorAlvo: metaLongaParsed.valor,
          prazoMeses: metaLongaParsed.prazo_meses,
        });
        if (meta) {
          const sim = simularMetaLonga(metaLongaParsed.valor, metaLongaParsed.prazo_meses);
          await safeSend(
            remoteJid,
            `🎯 *Meta "${metaLongaParsed.nome}" criada!*\n\n` +
              `💰 Alvo: ${formatBRL(metaLongaParsed.valor)}\n` +
              `📅 Prazo: ${metaLongaParsed.prazo_meses} meses (${(metaLongaParsed.prazo_meses / 12).toFixed(1)} anos)\n` +
              `📈 Pra bater no prazo: guardar ${formatBRL(sim.parcela_mensal)}/mês\n\n` +
              `💡 Pra atualizar quanto já guardou: fala "já juntei X" ou "atualiza meta Y pra X".`,
            instanceFromPayload,
          );
          return NextResponse.json({ ok: true, intent: 'meta_longa_set' });
        }
      } catch (e) {
        logError('meta_longa_set', e, { texto });
      }
    }

    // Detector de atualização de valor guardado (#overhaul metas-largas):
    // frases tipo "já juntei 30k pra casa" ou "atualiza meta Y pra X".
    const atualizacaoValor = parseAtualizacaoValorGuardado(texto);
    if (atualizacaoValor) {
      try {
        const metas = await listMetasLongas(userId);
        if (metas.length > 0) {
          // Pega a meta mais recente se user não especificou nome
          const alvo = atualizacaoValor.nome
            ? metas.find((m) => m.nome.toLowerCase().includes(atualizacaoValor.nome!.toLowerCase()))
            : metas[0];
          if (alvo) {
            const ok = await atualizarValorGuardado(alvo.id, atualizacaoValor.valor);
            if (ok) {
              const novoPct = (atualizacaoValor.valor / Number(alvo.valor_alvo)) * 100;
              await safeSend(
                remoteJid,
                `✅ Atualizei "${alvo.nome}": agora você tem ${formatBRL(atualizacaoValor.valor)} (${novoPct.toFixed(0)}% da meta).`,
                instanceFromPayload,
              );
              return NextResponse.json({ ok: true, intent: 'meta_longa_update' });
            }
          }
        }
      } catch (e) {
        logError('meta_longa_update', e, { texto });
      }
    }

    // Detector de "pergunta sobre mim": cai aqui quando o user manda
    // coisas como "o que você faz", "quem é você", "ajuda", "menu".
    // Antes do fallthrough genérico.
    //
    // Normaliza agressivamente pra cobrir grafias comuns:
    //   - acentos (é→e, ç→c)
    //   - espaços entre palavras (Oque = O que)
    //   - pontuação final (?, !, .)
    // Sem isso, "Oque você faz?" escapava do regex.
    const textoNorm = texto
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // tira diacríticos
      .replace(/[?!.]/g, '')
      .trim();
    // Recolapsa palavras compostas conhecidas (Oque→O que, Vc→Você, Voca→Voce)
    const textoCola = textoNorm
      .replace(/\boque\b/g, 'o que')
      .replace(/\bvc\b/g, 'voce')
      .replace(/\bvoca\b/g, 'voce')
      .replace(/\bvoce\b/g, 'voce');
    const ehPerguntaSobreBot =
      /\b(o\s+que\s+(voce|vc)\s+(faz|sabe|consegue|pode|faz\??)|quem\s+(e|a)\s+(voce|vc)|ajuda|help|menu|comandos?|o\s+que\s+(voce|vc)\s+e|para\s+que\s+(voce|vc)\s+serv|quais?\s+(coisas?|comandos?)\s+(voce|vc)\s+(faz|sabe)|como\s+(funciona|usar|uso)|oq\s+(vc|voce)\s+faz)\b/i.test(
        textoCola,
      );

    if (ehPerguntaSobreBot) {
      await safeSend(
        remoteJid,
        [
          '🤖 Sou seu painel no WhatsApp. Posso:',
          '',
          '💸 *Lançamentos*',
          '• "gastei 50 no mercado" → registra gasto',
          '• "recebi 1500 de freelance" → registra receita',
          '• "comprei um ingresso de 150" → cria categoria se não existir',
          '',
          '📊 *Consultas*',
          '• "quanto gastei esse mês?"',
          '• "qual meu saldo?"',
          '• "top categorias"',
          '',
          '✅ *Tarefas*',
          '• "tarefa pagar conta amanhã 14h"',
          '• "lista de tarefas"',
          '• "concluir tarefa X"',
          '',
          '🎯 *Metas*',
          '• "meta de 60 reais por dia"',
          '• "muda pra 80"',
          '',
          '📅 *Compromissos*',
          '• "aluguel dia 5 todo mês"',
          '',
          '🎙️ *Áudio* — manda áudio que eu transcrevo, sumo o que você disse e gravo na sua memória pra você buscar depois.',
          '',
          '💡 Dica: fala natural que eu entendo. Se travar, manda "ajuda" de novo.',
        ].join('\n'),
        instanceFromPayload,
      );
      return NextResponse.json({ ok: true, intent: 'help' });
    }

    await safeSend(
      remoteJid,
      '🤔 Não entendi. Pode reformular?\n\nExemplos:\n• "gastei 50 no mercado"\n• "recebi 1500 de freelance"\n• "quanto gastei esse mês?"\n\nOu manda "ajuda" pra ver o que eu sei fazer.',
      instanceFromPayload,
    );
    return NextResponse.json({ ok: true, intent: 'outro' });
  }

  // Validação cruzada de lancamento — se o Groq retornou amount=0 ou
  // inválido, ignora a interpretação e pede reformulação.
  if (parsed.intent === 'lancamento') {
    const p = parsed as Extract<typeof parsed, { intent: 'lancamento' }>;
    if (!Number.isFinite(p.amount) || p.amount <= 0) {
      console.warn(`[webhook] lancamento inválido (amount=${p.amount})`);
      await safeSend(
        remoteJid,
        '🤔 Não consegui identificar o valor. Tenta de novo tipo "gastei 50 no mercado".',
        instanceFromPayload,
      );
      return NextResponse.json({ ok: true, error: 'invalid_amount' });
    }
  }

  if (parsed.intent === 'lancamento') {
    const p = parsed as Extract<typeof parsed, { intent: 'lancamento' }>;

    // === Detecção de duplicata semântica (#3) ===
    // Se for gasto E já existe um registro muito parecido recente,
    // pergunta antes de inserir.
    if (p.type === 'gasto' && instanceFromPayload) {
      const dupe = await detectarDuplicata(userId, {
        amount: p.amount,
        category: p.category,
        description: p.description,
        payment_method: p.payment_method,
        occurred_at: p.occurred_at ?? todayISO(),
      });

      if (dupe) {
        // Grava pendingPrompt na sessão pra confirmar ou cancelar
        const promptMsg = formatarMensagemDuplicata(dupe, {
          amount: p.amount,
          category: p.category,
          description: p.description,
          payment_method: p.payment_method,
          occurred_at: p.occurred_at ?? todayISO(),
        });
        const sent = await safeSend(remoteJid, promptMsg, instanceFromPayload);
        await setContext(userId, remoteJid, instanceFromPayload, {
          pendingPrompt: {
            kind: 'dedup_confirm',
            promptMessageId: sent.id ?? '',
            payload: {
              amount: p.amount,
              category: p.category,
              description: p.description,
              payment_method: p.payment_method,
              occurred_at: p.occurred_at ?? todayISO(),
              confidence: p.confidence,
              existingRecordId: dupe.id,
            },
            ts: new Date().toISOString(),
          },
        });
        return NextResponse.json({ ok: true, intent: 'lancamento', deduplicated: true });
      }
    }

    // === AUTO-CATEGORIA (#overhaul) ===
    // Se parser não classificou, tenta Groq + UPSERT em categories.
    // Roda antes do INSERT pra usar o slug novo direto na confirmação.
    let autoCategoriaNova = false;
    let categoriaFinal = p.category;
    if (!categoriaFinal) {
      try {
        const auto = await autoCategorize(userId, texto, null);
        if (auto?.slug) {
          categoriaFinal = auto.slug;
          autoCategoriaNova = auto.isNew;
        }
      } catch (e) {
        logError('webhook_auto_categoria', e);
      }
    }

    // Pre-monta a string de confirmação (sem await, é puro)
    const sinal = p.type === 'gasto' ? '−' : '+';
    const tipoLabel = p.type === 'gasto' ? 'Gasto' : 'Receita';
    const catLabel = categoriaFinal ? ` em '${categoriaFinal}'` : '';
    const confirmacao = `✅ ${tipoLabel} de ${sinal}${formatBRL(p.amount)}${catLabel} registrado.`;

    // NER leve (#6): extrai entidades pra filtro futuro
    const entities = extrairEntidades(texto);

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
          category: categoriaFinal,
          description: p.description,
          payment_method: p.payment_method,
          occurred_at: p.occurred_at ?? todayISO(),
          source: 'whatsapp',
          source_message_id: messageId,
          metadata: {
            remote_jid: remoteJid,
            parsed_confidence: p.confidence,
            entities, // #6
            auto_category: autoCategoriaNova,
            ...(autoCategoriaNova && categoriaFinal ? { auto_category_slug: categoriaFinal } : {}),
          },
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

    // Aviso de meta diária (#extra) — checa se cruzou 80%/100% com esse gasto
    if (p.type === 'gasto' && instanceFromPayload) {
      const aviso = await checarAvisoMetaDiaria(
        userId,
        remoteJid,
        instanceFromPayload,
      );
      if (aviso) {
        await safeSend(remoteJid, aviso, instanceFromPayload);
      }
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

    const result = await executarAcao(userId, a.acao, a.alvo, {
      remoteJid,
      instanceName: instanceFromPayload,
    });
    await safeSend(remoteJid, result.reply, instanceFromPayload);
    return NextResponse.json({
      ok: true,
      intent: 'acao',
      deleted: result.deleted ?? 0,
      pendingConfirm: result.pendingConfirm,
    });
  }

  // === ORÇAMENTO / META (#10) ===
  if (
    parsed.intent === 'orcamento_set' ||
    parsed.intent === 'orcamento_get' ||
    parsed.intent === 'orcamento_delete'
  ) {
    const o = parsed as Extract<
      typeof parsed,
      { intent: 'orcamento_set' | 'orcamento_get' | 'orcamento_delete' }
    >;
    let result: { reply: string; ok: boolean };
    if (o.intent === 'orcamento_set') {
      result = await setOrcamento(userId, o.categoria, o.amount ?? 0);
    } else if (o.intent === 'orcamento_get') {
      result = await getOrcamento(userId, o.categoria);
    } else {
      result = await deleteOrcamento(userId, o.categoria);
    }
    await safeSend(remoteJid, result.reply, instanceFromPayload);
    return NextResponse.json({ ok: true, intent: o.intent });
  }

  // === META DIÁRIA (#extra) ===
  // Refinamento contextual (#overhaul Fase 3):
  // Se a última ação do user foi definir meta_diaria_set e a mensagem
  // atual é um comando curto de "muda/agora/passa pra X", interpretamos
  // como update sem precisar do parser completo.
  if (instanceFromPayload) {
    const sess = await getSession(userId, remoteJid, instanceFromPayload);
    if (sess.lastAction?.kind === 'meta_diaria_set') {
      const tl = texto.trim().toLowerCase();
      const mudaMatch = tl.match(
        /^(?:muda(?:r)?|agora|passa(?:r)?|troca(?:r)?|altera(?:r)?|bota(?:r)?|coloca(?:r)?)\s+(?:pra|para|pra)\s*(\d+(?:[,\.]\d+)?)\b/,
      );
      if (mudaMatch) {
        const novoValor = parseFloat(mudaMatch[1].replace(',', '.'));
        if (Number.isFinite(novoValor) && novoValor > 0) {
          logStage('meta_diaria_update_refinado', undefined, { from: sess.lastAction.params.amount, to: novoValor });
          const result = await setMetaDiaria(userId, novoValor);
          await safeSend(remoteJid, result.reply, instanceFromPayload);
          // Atualiza lastAction com novo valor
          await setContext(userId, remoteJid, instanceFromPayload, {
            lastAction: { kind: 'meta_diaria_set', params: { amount: novoValor }, ts: new Date().toISOString() },
          });
          return NextResponse.json({ ok: true, intent: 'meta_diaria_update', amount: novoValor });
        }
      }
    }
  }

  if (
    parsed.intent === 'meta_diaria_set' ||
    parsed.intent === 'meta_diaria_get' ||
    parsed.intent === 'meta_diaria_delete'
  ) {
    const m = parsed as Extract<
      typeof parsed,
      { intent: 'meta_diaria_set' | 'meta_diaria_get' | 'meta_diaria_delete' }
    >;
    let result: { reply: string; ok: boolean };
    if (m.intent === 'meta_diaria_set') {
      result = await setMetaDiaria(userId, m.amount ?? 0);
    } else if (m.intent === 'meta_diaria_get') {
      const meta = await getMetaDiaria(userId);
      if (meta == null) {
        result = { reply: '🤷 Nenhuma meta diária definida. Manda "definir meta diária de 100".', ok: false };
      } else {
        const gasto = await getGastoHoje(userId);
        result = {
          reply: `🎯 Meta diária: ${formatarIndicadorMeta(meta, gasto)}`,
          ok: true,
        };
      }
    } else {
      result = await deleteMetaDiaria(userId);
    }
    await safeSend(remoteJid, result.reply, instanceFromPayload);

    // Grava lastAction pra próximo refinamento (#overhaul Fase 3)
    if (instanceFromPayload && result.ok && m.intent === 'meta_diaria_set') {
      await setContext(userId, remoteJid, instanceFromPayload, {
        lastAction: { kind: 'meta_diaria_set', params: { amount: m.amount }, ts: new Date().toISOString() },
      });
    }

    return NextResponse.json({ ok: true, intent: m.intent });
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
  if (ehFraseMetaDiaria(t)) return 'financeiro';
  return 'outro';
}

/**
 * Meta Diária: "Meta de 60 reais gastos diariamente", "teto diário 150",
 * "posso gastar 100 por dia", "configurar meta diária 100", "definir
 * limite por dia". O `classificarModulo` acima exige verbo financeiro
 * + valor monetário (regex `temValorMonetario`), mas "meta diária 60"
 * não tem verbo conjugado nem decimal — caía em `'outro'` e o bot
 * respondia "Não entendi". Regra explícita antes do fallthrough:
 * se a frase tem palavras de meta (meta/limite/teto/máximo) E palavras
 * de temporalidade diária (diário/diariamente/por dia), é financeiro —
 * os regex novos do parser (`metaFlex`/`metaTeto`/`metaConfig`/
 * `metaPosso` em `modules/financeiro/lib/parser-mensagem.ts`) tratam.
 */
function ehFraseMetaDiaria(texto: string): boolean {
  const t = normalizarAcentos(texto.toLowerCase()).trim();
  const temMeta =
    /\b(meta|limite|teto|m[áa]ximo|m[áa]xim[ao]|or[çc]amento)\b/.test(t);
  const temDiario =
    /\b(di[áa]ri[ao]|diariamente|por\s+dia|de\s+dia|do\s+dia)\b/.test(t);
  // Combinação obrigatória: meta + diário (em qualquer ordem).
  return temMeta && temDiario;
}

/**
 * Detecta frases de meta longa tipo "quero juntar 100k em 5 anos".
 * Retorna `{ valor, prazo_meses, nome }` ou null se não detectar.
 *
 * Convenção:
 *   - valor: número puro (ex: 100000 pra "100k", 50000 pra "50 mil")
 *   - prazo_meses: sempre em meses (1 ano = 12)
 *   - nome: nome curto gerado automaticamente se user não deu explícito
 *
 * Cobre:
 *   "quero juntar 100k em 5 anos"      → {valor: 100000, prazo: 60, nome: "Juntar 100k"}
 *   "juntar 100 mil em 2 anos"         → idem
 *   "meta de 50k pra casa em 3 anos"   → idem, nome: "50k pra casa"
 *   "trocar carro em 2 anos"           → sem valor; usa default de 30k
 *   "guardar 10k em 12 meses"          → {valor: 10000, prazo: 12}
 *   "viajar em 1 ano"                  → sem valor; usa default 8k
 */
function parseFraseMetaLonga(texto: string): {
  valor: number;
  prazo_meses: number;
  nome: string;
} | null {
  const t = normalizarAcentos(texto.toLowerCase()).trim();

  // Precisa ter algum verbo de objetivo + marcador temporal.
  const temObjetivo = /\b(juntar|guardar|economizar|ter|fazer|alcancar|atingir|comprar|trocar|viajar|casar|aposentar|sobreviver|ter\s+\w+|montar)\b/.test(t);
  const temTemporal = /\b(em\s+\d+\s+(ano|anos|mes|meses)|daqui\s+a\s+\d+\s+(ano|anos|mes|meses)|pra\s+\d+\s+(ano|anos|mes|meses)|ate\s+\d+\s+(ano|anos|mes|meses)|ate\s+o\s+ano\s+que\s+vem|ano\s+que\s+vem|proximo\s+ano)\b/.test(t);
  // Tem que ter um OU outro pra ser meta longa (não só frase genérica).
  if (!temObjetivo && !temTemporal) return null;

  // Extrai valor
  // Padrões: "100k", "100 mil", "100.000", "R$ 100000", "100 reais".
  // IMPORTANTE: "mil" sozinho (sem "milhao") = 1000. "k" = 1000.
  // "M" maiúsculo ou "milhao"/"milhoes" = 1M. "m" minúsculo solto = ambíguo,
  // não casa pra evitar falso positivo em palavras como "meses".
  let valor = 0;
  const valorMatch =
    t.match(/\b(\d+(?:[.,]\d+)?)\s*(?:k|mil)\b/i) ||
    t.match(/\b(\d+(?:[.,]\d+)?)\s*(?:M|milhao|milhoes)\b/) ||
    t.match(/r?\$?\s*(\d{1,3}(?:[.,]\d{3})+|\d{4,})/) ||
    t.match(/\b(\d+)\s*reais?\b/);
  if (valorMatch) {
    let n = parseFloat(valorMatch[1].replace(',', '.'));
    const sufixo = valorMatch[0].toLowerCase();
    if (sufixo.includes('k') || /\bmil\b/.test(sufixo)) n *= 1_000;
    else if (sufixo.includes('milhao') || sufixo.includes('m')) n *= 1_000_000;
    valor = Math.round(n);
  }

  // Extrai prazo
  let prazoMeses = 0;
  const prazoMatch = t.match(
    /\b(?:em|daqui\s+a|pra|ate)\s+(\d+)\s+(ano|anos|mes|meses)\b/,
  );
  if (prazoMatch) {
    const n = parseInt(prazoMatch[1], 10);
    prazoMeses = prazoMatch[2].startsWith('ano') ? n * 12 : n;
  } else if (/ano\s+que\s+vem|proximo\s+ano/.test(t)) {
    prazoMeses = 12;
  }

  // Tem que ter pelo menos 1 dos 2 (valor ou prazo) E ter detectado
  // uma frase de objetivo. Se nada, não é meta longa.
  if (valor === 0 && prazoMeses === 0) return null;

  // Default de valor se user só deu prazo (ex: "trocar carro em 2 anos")
  if (valor === 0) valor = 30_000; // fallback razoável

  // Default de prazo se user só deu valor (ex: "quero juntar 100k")
  if (prazoMeses === 0) prazoMeses = 24; // 2 anos

  // Gera nome descritivo baseado no verbo + complemento
  let nome = '';
  const verboUsado =
    t.match(/\b(juntar|guardar|economizar|comprar|trocar|viajar|montar|casar|aposentar)\b/)?.[1] ?? null;
  const nomeMatch = t.match(
    /\b(?:pra|para|de)\s+([a-záéíóúâêôãõç\s]{3,30}?)(?:\s+em|\s+daqui|$)/,
  );
  if (nomeMatch) {
    const verbox = verboUsado ? verboUsado.charAt(0).toUpperCase() + verboUsado.slice(1) : 'Juntar';
    nome = `${verbox} ${formatK(valor)} pra ${nomeMatch[1].trim()}`;
  } else if (/trocar\s+\w+/.test(t)) {
    const carro = t.match(/\btrocar\s+(?:de\s+|o\s+)?(\w+)/);
    nome = carro ? `Trocar ${carro[1]}` : `Trocar veículo`;
  } else if (/viajar/.test(t)) {
    nome = `Viajar`;
  } else if (/comprar/.test(t)) {
    const coisa = t.match(/\bcomprar\s+(?:um|uma|o|a)?\s*(\w+)/);
    nome = coisa ? `Comprar ${coisa[1]}` : `Comprar`;
  } else {
    nome = `${verboUsado ? verboUsado.charAt(0).toUpperCase() + verboUsado.slice(1) : 'Juntar'} ${formatK(valor)}`;
  }

  // Capitaliza primeira letra
  nome = nome.charAt(0).toUpperCase() + nome.slice(1);

  return { valor, prazo_meses: prazoMeses, nome };
}

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
}

/**
 * Detecta frases de atualização de valor guardado tipo
 * "já juntei 30k", "tenho 30 mil guardados", "atualiza meta pra 30k".
 * Retorna `{ valor, nome? }` ou null.
 */
function parseAtualizacaoValorGuardado(texto: string): {
  valor: number;
  nome: string | null;
} | null {
  const t = normalizarAcentos(texto.toLowerCase()).trim();

  // Palavras gatilho: "já juntei", "tenho", "guardei", "já tenho",
  // "atualiza meta", "atualizar meta"
  const temGatilho =
    /\b(ja\s+(juntei|tenho|guardei|tenho)|tenho|guardei|atualiza\s+meta|atualizar\s+meta|mudei\s+meta|coloquei\s+na\s+meta)\b/.test(t);
  if (!temGatilho) return null;

  // Extrai valor (mesma lógica do parser de meta longa — não casa "m"
  // solto pra evitar falso positivo com palavras tipo "meses")
  const valorMatch =
    t.match(/\b(\d+(?:[.,]\d+)?)\s*(?:k|mil)\b/i) ||
    t.match(/\b(\d+(?:[.,]\d+)?)\s*(?:M|milhao|milhoes)\b/) ||
    t.match(/r?\$?\s*(\d{1,3}(?:[.,]\d{3})+|\d{4,})/) ||
    t.match(/\b(\d+)\s*reais?\b/);
  if (!valorMatch) return null;

  let n = parseFloat(valorMatch[1].replace(',', '.'));
  const sufixo = valorMatch[0].toLowerCase();
  if (sufixo.includes('k') || /\bmil\b/.test(sufixo)) n *= 1_000;
  else if (sufixo.includes('milhao') || sufixo.includes('m')) n *= 1_000_000;
  const valor = Math.round(n);

  // Tenta extrair nome da meta (palavras depois de "pra")
  let nome: string | null = null;
  const nomeMatch = t.match(/\b(?:pra|para|de)\s+([a-záéíóúâêôãõç\s]{3,30}?)(?:\s|$)/);
  if (nomeMatch && !['a', 'o', 'minha', 'minhas', 'uma', 'meta'].includes(nomeMatch[1].trim())) {
    nome = nomeMatch[1].trim();
  }

  return { valor, nome };
}
