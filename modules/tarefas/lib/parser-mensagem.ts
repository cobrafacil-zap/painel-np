/**
 * Parser de mensagens WhatsApp → tarefa (intent: 'tarefa' ou 'tarefa_ambigua').
 *
 * Estratégia:
 *  1. Pré-parser local (regex): extrai tokens de data/hora + marcadores
 *     fortes. Se confiança ≥ 0.85, retorna direto.
 *  2. Cai pro Groq com prompt dedicado. Llama-3.1-8b-instant (rápido).
 *  3. Falha de JSON → fallback pro local.
 *
 * Tokens são opacos (não ISO). Quem converte pra ISO é `lib/datas`.
 */

import { generateText } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { numerosPorExtensoParaDigitos } from '@/lib/numeros';
import { normalizarAcentos } from '@/lib/acentos';
import { carregarContextoTarefa } from '@/lib/tarefas/patterns';
import { logStage, logError } from '@/lib/log';
import type { TokenData, TokenHora } from '@/lib/datas';

export type TarefaParsedIntent =
  | {
      intent: 'tarefa';
      confidence: number;
      titulo: string;
      descricao: string | null;
      data_token: TokenData | null;
      hora_token: TokenHora | null;
      categoria: string | null;
      prioridade: 'baixa' | 'media' | 'alta';
      recorrencia: 'semanal' | 'mensal' | null;
    }
  | {
      intent: 'tarefa_ambigua';
      confidence: number;
      motivo: 'sem_data' | 'sem_data_com_hora' | 'categoria_duvidosa' | 'financeiro_ou_tarefa';
    };

const SYSTEM_PROMPT = `Você é o parser de TAREFAS/LEMBRETES de um painel pessoal brasileiro.
Responda SEMPRE em JSON puro (sem markdown, sem comentários, sem texto antes/depois).

INTENÇÃO: tarefa (compromisso com prazo/lembrete). Tarefa é uma AÇÃO PENDENTE
que o usuário precisa FAZER/IR/REUNIR/ENTREGAR/LIGAR/LEMBRAR — diferente de
lançamento financeiro (gasto/receita) ou dívida (compromisso financeiro).

SAÍDA (JSON ESTRITO, NADA MAIS):
{
  "intent": "tarefa" | "tarefa_ambigua",
  "confidence": number 0..1,
  // tarefa:
  "titulo": "string curta sem verbo auxiliar",
  "descricao": "string|null",
  "data_token": "HOJE|AMANHA|SEXTA|SABADO|DOMINGO|SEGUNDA|TERCA|QUARTA|QUINTA|FIM_MES|SEMANA_QUE_VEM|MES_QUE_VEM|DIA_5..31|PROX_DIA_5..31|DAQUI_N_DIAS|null",
  "hora_token": "14h|14:30|DE_MANHA|DE_TARDE|DE_NOITE|null",
  "categoria": "trabalho|pessoal|saude|estudo|projeto|financeiro|outros|null",
  "prioridade": "baixa|media|alta",
  "recorrencia": "semanal|mensal|null",
  // tarefa_ambigua:
  "motivo": "sem_data|sem_data_com_hora|categoria_duvidosa|financeiro_ou_tarefa"
}

═══════════════════════════════════════════
EXEMPLOS — intent: tarefa
═══════════════════════════════════════════

"tenho que fazer reunião sexta às 14h" →
{"intent":"tarefa","confidence":0.97,"titulo":"Reunião","descricao":null,"data_token":"SEXTA","hora_token":"14h","categoria":null,"prioridade":"media","recorrencia":null}

"preciso lançar a campanha de tráfego pago até dia 25" →
{"intent":"tarefa","confidence":0.96,"titulo":"Lançar campanha de tráfego pago","descricao":null,"data_token":"DIA_25","hora_token":null,"categoria":"trabalho","prioridade":"media","recorrencia":null}

"lembrete: ligar pro dentista amanhã de manhã" →
{"intent":"tarefa","confidence":0.95,"titulo":"Ligar pro dentista","descricao":null,"data_token":"AMANHA","hora_token":"DE_MANHA","categoria":"pessoal","prioridade":"media","recorrencia":null}

"reunião semanal toda quarta às 10h" →
{"intent":"tarefa","confidence":0.94,"titulo":"Reunião semanal","descricao":null,"data_token":null,"hora_token":"10h","categoria":"trabalho","prioridade":"media","recorrencia":"semanal"}

"entregar relatório até sexta" →
{"intent":"tarefa","confidence":0.93,"titulo":"Entregar relatório","descricao":null,"data_token":"SEXTA","hora_token":null,"categoria":"trabalho","prioridade":"media","recorrencia":null}

"daqui a 3 dias preciso ver o carro na oficina" →
{"intent":"tarefa","confidence":0.92,"titulo":"Ver o carro na oficina","descricao":null,"data_token":"DAQUI_3_DIAS","hora_token":null,"categoria":"pessoal","prioridade":"media","recorrencia":null}

"urgente: terminar apresentação amanhã" →
{"intent":"tarefa","confidence":0.95,"titulo":"Terminar apresentação","descricao":null,"data_token":"AMANHA","hora_token":null,"categoria":"trabalho","prioridade":"alta","recorrencia":null}

═══════════════════════════════════════════
EXEMPLOS — intent: tarefa_ambigua
═══════════════════════════════════════════

"fazer a campanha" →
{"intent":"tarefa_ambigua","confidence":0.88,"motivo":"sem_data"}

"ligar pra cliente às 16h" →
{"intent":"tarefa_ambigua","confidence":0.86,"motivo":"sem_data_com_hora"}

"pagar freelancer até sexta" →
{"intent":"tarefa_ambigua","confidence":0.84,"motivo":"financeiro_ou_tarefa"}

═══════════════════════════════════════════
REGRAS CRÍTICAS
═══════════════════════════════════════════

• TAREFA vs FINANCEIRO:
  - Verbo "fazer/ir/reunião/entregar/lembrar/ligar/lembrete/campanha/anotar" → tarefa.
  - Verbo "gastei/paguei/recebi/peguei emprestado/emprestei/comprei" + valor monetário → FINANCEIRO (não tarefa, não é nosso caso aqui).
  - "pagar freelancer até sexta" (verbo pagar + sem valor + prazo) → tarefa_ambigua motivo=financeiro_ou_tarefa.

• DATA: SEMPRE em token. Calcule SEMANA_QUE_VEM como a próxima segunda.
  "semana que vem" → SEMANA_QUE_VEM. "mês que vem" → MES_QUE_VEM.
  "todo dia 5" → DIA_5. "próximo dia 5" → PROX_DIA_5.
  "daqui a 3 dias" → DAQUI_3_DIAS. "daqui a N dias" (N=1..30).
  "fim do mês" → FIM_MES.
  "toda quarta" (recorrente) → data_token=null.

• HORA: "às 14h" → "14h". "às 14:30" → "14:30". "de manhã" → DE_MANHA.
  "de tarde" → DE_TARDE. "de noite" → DE_NOITE. Se não tem hora explícita
  E não é recorrente → hora_token=null (vira prazo).

• CATEGORIA: só atribua se tiver palavra-chave óbvia. Senão devolva null.
  - trabalho|cliente|reunião|projeto|campanha|escritório|empresa → "trabalho"
  - pessoal|família|mãe|pai|esposa|filho|amigo → "pessoal"
  - saúde|médico|dentista|academia|exame|remédio → "saude"
  - estudo|faculdade|curso|aula|livro|prova → "estudo"
  - financeiro|conta|boleto|banco|investimento → "financeiro"
  - Em dúvida → null (será perguntado depois).

• PRIORIDADE: "alta" só se "urgente|importante|crítico|asap|imediato" explícito.
  Senão "media". "quando der|quando puder|sem pressa" → "baixa".

• RECORRÊNCIA: "toda semana|semanalmente|todo dia da semana|toda X|dariamente" → "semanal".
  "todo mês|mensalmente|mês a mês" → "mensal". Senão null.

• TÍTULO: substantivo + complemento curto, sem verbo auxiliar.
  "tenho que fazer reunião" → "Reunião". "preciso lançar a campanha de tráfego"
  → "Lançar campanha de tráfego". Máximo ~50 chars.

• AMBIGUIDADE:
  - "fazer a campanha" sem prazo → tarefa_ambigua motivo=sem_data.
  - "ligar pra cliente às 16h" sem dia → tarefa_ambigua motivo=sem_data_com_hora.
  - "fazer X até sexta" sem categoria clara → tarefa_ambigua motivo=categoria_duvidosa.
  - "pagar freelancer até sexta" → tarefa_ambigua motivo=financeiro_ou_tarefa.

• CONFIDENCE: 0.95+ pra casos claros. 0.7-0.9 se ambíguo.
• NÃO escreva markdown. APENAS {...}.`;

/**
 * Pré-parser local (regex). Cobre os casos óbvios.
 */
function tentarParseLocalTarefa(texto: string): TarefaParsedIntent | null {
  const t = texto.trim();
  if (!t) return null;
  const tl = normalizarAcentos(t.toLowerCase());

  // Marcadores fortes de tarefa
  const temMarcadorForte =
    /\b(tenho que|preciso|vou\s+(?:fazer|ir|ligar|entregar|marcar|lembrar)|lembrar|lembrete|reuni[ãa]o|entregar|ligar|anotar|anota|agendar|marcar|campanha)\b/i.test(
      tl
    );

  // Marcador suave (sem exigir) — cobre "fazer X" mas classifica como tarefa_ambigua
  // se não tiver marcador forte.
  const temMarcadorSuave = /\b(fazer|ir|chamar|mandar|responder|enviar|buscar)\b/i.test(tl);

  // Detecta data/hora explícita. Usado pra aceitar mensagens SEM marcador
  // de tarefa mas COM data/hora (ex: "Amanhã às 10h", "sexta 14h",
  // "amanhã dentista"). Sem isso, o pré-parser rejeitava essas frases e
  // elas caíam direto no Groq, que erra.
  // IMPORTANTE: usa `tl` (já normalizado pelo normalizarAcentos) porque
  // `\b` em V8 sem flag `/u` não casa antes/depois de letras acentuadas
  // Latin-1 (ã, á, é, ...). Ver lib/acentos.ts.
  const temDataOuHora =
    /\b(hoje|amanha|semana\s+que\s+vem|mes\s+que\s+vem|fim\s+(?:do|de)\s+mes|segunda|terca|quarta|quinta|sexta|sabado|domingo|daqui\s+a\s+\d+\s+dias?|proximo\s+dia\s+\d+|dia\s+\d{1,2})\b/i.test(
      tl
    ) ||
    /\b(?:as?\s+\d{1,2}(?:h(?:\d{2})?|:\d{2})|de\s+(?:manha|tarde|noite)|\d{1,2}h(?:\d{2})?|\d{1,2}:\d{2})\b/i.test(
      tl
    );

  // Sem marcador forte E sem data/hora explícita → não é tarefa (deixa
  // pro Groq ou cai em "outro"). Esse é o caso de "fazer a campanha" sem
  // data, que vira tarefa_ambigua sem_data quando Groq processa.
  if (!temMarcadorForte && !temDataOuHora) return null;

  // Recorrência (usa tl normalizado pra evitar \b falhar com acentos)
  let recorrencia: 'semanal' | 'mensal' | null = null;
  if (/\b(toda\s+semana|semanalmente|toda\s+\w+feira|todo\s+mes|mensalmente|mes\s+a\s+mes)\b/i.test(tl)) {
    if (/semanal|semana|feira/i.test(tl)) recorrencia = 'semanal';
    else if (/mensal|mes/i.test(tl)) recorrencia = 'mensal';
  }

  // Hora (tl normalizado: 'as 10h' em vez de 'às 10h')
  let hora_token: TokenHora | null = null;
  let horaStr: string | null = null;
  const hm = tl.match(/as?\s+(\d{1,2})h(?:(\d{2}))?/i);
  const hm2 = tl.match(/as?\s+(\d{1,2}):(\d{2})/);
  if (hm) {
    const h = parseInt(hm[1], 10);
    const mm = hm[2] ? parseInt(hm[2], 10) : 0;
    if (mm > 0) {
      hora_token = `${h}:${pad2(mm)}` as TokenHora;
      horaStr = `${pad2(h)}:${pad2(mm)}:00`;
    } else {
      hora_token = `${h}h` as TokenHora;
      horaStr = `${pad2(h)}:00:00`;
    }
  } else if (hm2) {
    const h = parseInt(hm2[1], 10);
    const mm = parseInt(hm2[2], 10);
    hora_token = `${h}:${pad2(mm)}` as TokenHora;
    horaStr = `${pad2(h)}:${pad2(mm)}:00`;
  } else if (/\bde\s+manha\b/i.test(tl)) {
    hora_token = 'DE_MANHA';
    horaStr = '09:00:00';
  } else if (/\bde\s+tarde\b/i.test(tl)) {
    hora_token = 'DE_TARDE';
    horaStr = '14:00:00';
  } else if (/\bde\s+noite\b/i.test(tl)) {
    hora_token = 'DE_NOITE';
    horaStr = '20:00:00';
  }

  // Data
  // IMPORTANTE: usa `tl` (normalizado pelo normalizarAcentos) porque
  // `\b` em V8 sem flag `/u` não casa antes/depois de letras acentuadas
  // Latin-1. Ver lib/acentos.ts.
  let data_token: TokenData | null = null;
  if (/\bhoje\b/i.test(tl)) data_token = 'HOJE';
  else if (/\bamanha\b/i.test(tl)) data_token = 'AMANHA';
  else if (/\bsemana\s+que\s+vem\b/i.test(tl)) data_token = 'SEMANA_QUE_VEM';
  else if (/\bmes\s+que\s+vem\b/i.test(tl)) data_token = 'MES_QUE_VEM';
  else if (/\bfim\s+(?:do|do|de)\s+mes\b/i.test(tl)) data_token = 'FIM_MES';
  else if (/\bsegunda\b/i.test(tl)) data_token = 'SEGUNDA';
  else if (/\bterca\b/i.test(tl)) data_token = 'TERCA';
  else if (/\bquarta\b/i.test(tl)) data_token = 'QUARTA';
  else if (/\bquinta\b/i.test(tl)) data_token = 'QUINTA';
  else if (/\bsexta\b/i.test(tl)) data_token = 'SEXTA';
  else if (/\bsabado\b/i.test(tl)) data_token = 'SABADO';
  else if (/\bdomingo\b/i.test(tl)) data_token = 'DOMINGO';
  else {
    const daqui = tl.match(/\bdaqui\s+a\s+(\d{1,2})\s+dias?\b/i);
    if (daqui) {
      const n = parseInt(daqui[1], 10);
      data_token = `DAQUI_${n}_DIAS` as TokenData;
    } else {
      const prox = tl.match(/\bproximo\s+dia\s+(\d{1,2})\b/i);
      if (prox) {
        data_token = `PROX_DIA_${parseInt(prox[1], 10)}` as TokenData;
      } else {
        const dia = tl.match(/\bdia\s+(\d{1,2})\b/i);
        if (dia) data_token = `DIA_${parseInt(dia[1], 10)}` as TokenData;
      }
    }
  }

  // Categoria — só se palavra-chave óbvia (usa tl normalizado)
  let categoria: string | null = null;
  if (/\b(cliente|reuniao|projeto|campanha|escritorio|empresa|trabalho)\b/i.test(tl)) {
    categoria = 'trabalho';
  } else if (/\b(mae|pai|esposa|filho|amigo|familia)\b/i.test(tl)) {
    categoria = 'pessoal';
  } else if (/\b(medico|dentista|academia|exame|remedio|saude)\b/i.test(tl)) {
    categoria = 'saude';
  } else if (/\b(faculdade|curso|aula|livro|prova|estudo)\b/i.test(tl)) {
    categoria = 'estudo';
  } else if (/\b(banco|conta|boleto|investimento|financeiro)\b/i.test(tl)) {
    categoria = 'financeiro';
  }

  // Prioridade (usa tl normalizado)
  let prioridade: 'baixa' | 'media' | 'alta' = 'media';
  if (/\b(urgente|importante|critico|asap|imediato|agora)\b/i.test(tl)) prioridade = 'alta';
  else if (/\b(quando\s+der|quando\s+puder|sem\s+pressa)\b/i.test(tl)) prioridade = 'baixa';

  // Título — pega substantivo principal. Heurística simples:
  // remove marcadores (tenho que, preciso, vou) + remove data/hora + remove
  // trecho temporal e usa o resto.
  // Limpa o título removendo marcadores e trechos temporais. Trabalha em
  // `tl` (normalizado) pra evitar \b falhar com acentos.
  let tituloLimpo = tl
    .replace(/^(tenho\s+que|preciso|vou|lembrete:?|anotar:?|anota:?)/i, '')
    .replace(/,?\s*(amanha|hoje|semana\s+que\s+vem|mes\s+que\s+vem|fim\s+(?:do|do|de)\s+mes|segunda|terca|quarta|quinta|sexta|sabado|domingo)$/i, '')
    .replace(/\b(?:daqui\s+a\s+\d+\s+dias?|proximo\s+dia\s+\d+|dia\s+\d{1,2})\b/i, '')
    .replace(/\b(?:as?\s+\d{1,2}h(?:\d{2})?|as?\s+\d{1,2}:\d{2}|de\s+(?:manha|tarde|noite))\b/i, '')
    .replace(/\b(?:ate?\s+(?:dia|o\s+dia|a\s+data|sexta|quarta|quinta|terca|segunda|sabado|domingo|amanha|hoje))\b/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Se sobrou vazio ou só verbos, usa primeira frase nominal
  if (!tituloLimpo || tituloLimpo.length < 3) {
    tituloLimpo = tl.replace(/\b(tenho\s+que|preciso|vou|lembrete:?)\b/i, '').trim();
  }

  // Capitaliza primeira letra
  const titulo = tituloLimpo.charAt(0).toUpperCase() + tituloLimpo.slice(1);

  // === Decisões de retorno ===
  // Sem data E sem recorrência E sem marcador forte → tarefa_ambigua
  // sem_data (ou sem_data_com_hora se tem hora). Mensagens curtas tipo
  // "Amanhã às 10h" já têm data_token (AMANHA), então não caem aqui.
  // Caem aqui: "fazer a campanha" (sem data), "ligar pra cliente às 16h"
  // (sem dia, só hora).
  if (!data_token && !recorrencia && !temDataOuHora) {
    const motivo: 'sem_data' | 'sem_data_com_hora' =
      horaStr ? 'sem_data_com_hora' : 'sem_data';
    return { intent: 'tarefa_ambigua', confidence: 0.88, motivo };
  }

  // Se chegou aqui, temos data_token OU recorrencia OU temDataOuHora.
  // Se não temos marcador forte mas a frase é "só data/hora" (sem verbo),
  // geramos um título genérico baseado no que sobrou.
  let tituloFinal = titulo;
  if (!temMarcadorForte && (!titulo || titulo === t || titulo.length < 3)) {
    // Título vazio ou idêntico ao texto original. Tenta usar o que sobrou
    // depois de remover data/hora. Se sobrar só "às 10h", usa fallback.
    tituloFinal =
      tituloLimpo && tituloLimpo.length >= 3
        ? titulo.charAt(0).toUpperCase() + tituloLimpo.slice(1)
        : 'Lembrete';
  }

  // Se marcador é só suave (sem forte), confiança mais baixa
  const confBase = temMarcadorForte ? 0.92 : temDataOuHora ? 0.86 : 0.78;
  return {
    intent: 'tarefa',
    confidence: confBase,
    titulo: tituloFinal,
    descricao: null,
    data_token,
    hora_token,
    categoria,
    prioridade,
    recorrencia,
  };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

let _groq: ReturnType<typeof createGroq> | null = null;
function getGroq() {
  if (_groq) return _groq;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY não configurada');
  _groq = createGroq({ apiKey });
  return _groq;
}

/**
 * Parser principal. Tenta regex local primeiro; se não bater, cai pro Groq.
 *
 * `opts.userId` é opcional — quando passado, injeta memória de padrões
 * de tarefas (#overhaul, paralelo ao financeiro).
 */
export async function parseTarefa(
  texto: string,
  opts?: { userId?: string }
): Promise<TarefaParsedIntent> {
  const textoNorm = numerosPorExtensoParaDigitos(texto);

  // 1. Local
  const local = tentarParseLocalTarefa(textoNorm);
  // Threshold cobre: tarefa_ambigua (0.88), tarefa forte (0.92),
  // tarefa data/hora sem verbo (0.86), tarefa marcador suave (0.78).
  // Qualquer hit local >= 0.78 já é mais confiável que deixar o Groq
  // decidir (que erra muito sem contexto).
  if (local && local.confidence >= 0.78) {
    logStage('parser_tarefa_local_hit', undefined, {
      intent: local.intent,
      confidence: local.confidence,
    });
    return local;
  }

  // 2. Groq
  try {
    const groq = getGroq();

    // Monta system prompt com contexto de tarefas do user (#overhaul)
    let systemPrompt = SYSTEM_PROMPT;
    if (opts?.userId) {
      const contexto = await carregarContextoTarefa(opts.userId);
      systemPrompt = SYSTEM_PROMPT + contexto;
    }

    const t0 = Date.now();
    const { text } = await generateText({
      model: groq('llama-3.1-8b-instant'),
      system: systemPrompt,
      prompt: textoNorm,
      temperature: 0.05,
      maxTokens: 500,
    });
    logStage('parser_tarefa_groq_done', Date.now() - t0, { len: text.length });
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) {
      if (local) return local;
      return { intent: 'tarefa_ambigua', confidence: 0, motivo: 'sem_data' };
    }
    try {
      return JSON.parse(match[0]) as TarefaParsedIntent;
    } catch {
      if (local) return local;
      return { intent: 'tarefa_ambigua', confidence: 0, motivo: 'sem_data' };
    }
  } catch (e) {
    logError('parser_tarefa_groq', e);
    if (local) return local;
    return { intent: 'tarefa_ambigua', confidence: 0, motivo: 'sem_data' };
  }
}
