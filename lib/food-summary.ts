/**
 * Reconhecimento de comida por foto (#feature alimentação).
 *
 * Dois modos de análise:
 *   - `analyzeFoodPhoto()` (silencioso) → só macros estruturados pra salvar
 *     no banco. NÃO envia nada pro user. Resposta do WhatsApp é uma msg
 *     curta de confirmação + botão "análise completa".
 *   - `analyzeFoodPhotoDetailed()` (explícito) → texto corrido estilo
 *     nutricionista quando o user pede. Salva o texto em `ai_summary` da
 *     refeição pra histórico.
 *
 * Primário: Google Gemini 2.5 Flash Lite (precisa de GOOGLE_GENERATIVE_AI_API_KEY).
 * Fallback: Groq qwen/qwen3.8-27b (vision-capable atual na Groq, depois
 * do deprecate do llama-3.2-90b-vision em 2026-04).
 *
 * Tolerante a schemas diferentes — parser aceita aliases (itens/
 * alimentos_identificados, kcal/calorias, prot/proteinas, etc).
 */

import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { logStage, logError } from './log';
import type { RefeicaoData } from './food-photo-storage';

let _google: ReturnType<typeof createGoogleGenerativeAI> | null = null;
function getGoogle() {
  if (_google) return _google;
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY não configurada');
  _google = createGoogleGenerativeAI({ apiKey });
  return _google;
}

let _groq: ReturnType<typeof createGroq> | null = null;
function getGroq() {
  if (_groq) return _groq;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY não configurada');
  _groq = createGroq({ apiKey });
  return _groq;
}

const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const GROQ_VISION_MODEL = 'qwen/qwen3.8-27b';

// ============================================================
// PROMPT MODO SILENCIOSO (padrão)
// ============================================================
const SYSTEM_PROMPT_SILENT = `Você é nutricionista especializado em comida brasileira.
Analise a foto e extraia os ALIMENTOS VISÍVEIS com porção estimada em gramas e macros.
Responda SOMENTE em JSON puro válido (sem markdown, sem texto antes/depois).

SCHEMA EXATO:
{
  "meal_type": "cafe" | "almoco" | "jantar" | "lanche",
  "confianca": 0.0 a 1.0,
  "itens": [
    { "nome": "arroz branco cozido", "gramas": 150, "kcal": 195, "prot": 4.1, "carb": 43.0, "gord": 0.5 }
  ],
  "totais": { "kcal": 520, "prot": 35.0, "carb": 60.0, "gord": 18.0, "portion_g": 350 }
}

REGRAS:
- Liste cada ITEM SEPARADO. Não agrupe.
- Use TBCA (Tabela Brasileira de Composição de Alimentos) como base.
- Sem referência visual (sem prato/moeda/mão) → confiança <0.6.
- Foto NÃO for de comida → retorne {"nao_e_comida": true}.
- Caption do usuário (se houver): use como HINT, só se consistente com a foto.
- Idioma: pt-BR.
- meal_type: antes 10h=cafe, 10-15h=almoco, 15-18h=lanche, depois 18h=jantar.
- USE EXATAMENTE as chaves acima. Não invente nomes.`;

// ============================================================
// PROMPT MODO DETALHADO (quando user pede)
// ============================================================
const SYSTEM_PROMPT_DETAILED = `Você é uma nutricionista brasileira experiente, didática, e usa uma linguagem acessível (sem jargões).
O usuário mandou uma foto do prato dele. Faça uma análise CURTA mas útil no estilo:

[emoji] Visão geral do prato (1 linha, tom de conversa)
[ex: "Esse prato está bem equilibrado, principalmente pela quantidade de carne."]

*O que está muito bom:*
• ponto 1
• ponto 2

*O que mais pesa nas calorias:*
• item X (~Y kcal)
• item Z pode adicionar mais W kcal

*Sugestão prática:*
• 1 troca ou ajuste que cortaria X kcal sem perder saciedade

*Para emagrecer:* ajustar 1-2 linhas práticas
*Para academia/bulk:* ajustar 1-2 linhas práticas

REGRAS DE RESPOSTA:
- Texto corrido em PT-BR, sem markdown pesado, use *bold* com asteriscos.
- Total ~150-200 palavras. Não enrole.
- SEM JSON. SEM listas longas. Tom de conversa, não laudo técnico.
- Se foto não for comida: responda "❌ Essa foto não parece de comida — manda uma foto do prato."
- Se foto muito ambígua: mencione a limitação sem inventar números.
- NUNCA mencione "como IA", "modelo de linguagem" ou processo interno.
- NÃO cite marcas. NÃO julgue moralmente ("você deveria...").`;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface AnalyzeParams {
  base64: string;
  mimeType: string;
  caption?: string | null;
  horaAtualBRT?: { hora: number };
}

/**
 * === MODO SILENCIOSO (padrão) ===
 * Tenta Gemini → Groq. Retorna macros estruturados OU null.
 * Não retorna texto pro user — quem responde é o webhook.
 */
export async function analyzeFoodPhoto(
  params: AnalyzeParams,
): Promise<Omit<RefeicaoData, 'descricao_user' | 'ai_model'> | null> {
  if (!params.base64 || params.base64.length < 100) return null;

  const approxBytes = (params.base64.length * 3) / 4;
  if (approxBytes > MAX_IMAGE_BYTES) {
    logError('food_photo_too_big', new Error(`~${approxBytes} bytes`), {});
    return null;
  }

  const dataUri = `data:${params.mimeType};base64,${params.base64}`;
  const userPrompt = params.caption
    ? `Analise esta foto de comida brasileira. O usuário disse: "${params.caption}". Use como dica só se consistente com a foto.`
    : 'Analise esta foto de comida brasileira.';

  // Tentativa 1: Gemini
  try {
    const t0 = Date.now();
    const google = getGoogle();
    const { text } = await generateText({
      model: google(GEMINI_MODEL),
      system: SYSTEM_PROMPT_SILENT,
      messages: [{ role: 'user', content: [
        { type: 'text', text: userPrompt },
        { type: 'image', image: dataUri },
      ]}],
      temperature: 0.1,
      maxTokens: 2000,
    });
    logStage('food_summary_gemini_ok', Date.now() - t0, { hasCaption: !!params.caption, provider: 'gemini' });
    const parsed = parseRefeicaoJson(text);
    if (parsed) return parsed;
  } catch (e) {
    logError('food_summary_gemini_fail', e);
  }

  // Tentativa 2: Groq fallback
  try {
    const t0 = Date.now();
    const groq = getGroq();
    const { text } = await generateText({
      model: groq(GROQ_VISION_MODEL),
      system: SYSTEM_PROMPT_SILENT,
      messages: [{ role: 'user', content: [
        { type: 'text', text: userPrompt },
        { type: 'image', image: dataUri },
      ]}],
      temperature: 0.1,
      maxTokens: 2000,
    });
    logStage('food_summary_groq_ok', Date.now() - t0, { hasCaption: !!params.caption, provider: 'groq' });
    const parsed = parseRefeicaoJson(text);
    if (parsed) return parsed;
  } catch (e) {
    logError('food_summary_groq_fail', e);
  }

  console.warn('[analyzeFoodPhoto] ambos providers falharam em extrair macros');
  return null;
}

/**
 * === MODO DETALHADO ===
 * Retorna texto corrido no estilo nutricionista. Salva em `ai_summary`
 * da refeição pra histórico (webhook grava).
 *
 * Retorna null se Gemini+Groq falharem.
 */
export interface DetailedAnalysis {
  text: string;
  model: string;
  parsed?: Omit<RefeicaoData, 'ai_model'> | null; // opcional — tentamos extrair macros tb
}

export async function analyzeFoodPhotoDetailed(
  params: AnalyzeParams,
): Promise<DetailedAnalysis | null> {
  if (!params.base64 || params.base64.length < 100) return null;

  const dataUri = `data:${params.mimeType};base64,${params.base64}`;
  const userPrompt = params.caption
    ? `Analise esta foto de comida brasileira. O usuário disse: "${params.caption}". Use como dica só se consistente com a foto.`
    : 'Analise esta foto de comida brasileira.';

  // Gemini (texto corrido)
  try {
    const t0 = Date.now();
    const google = getGoogle();
    const { text } = await generateText({
      model: google(GEMINI_MODEL),
      system: SYSTEM_PROMPT_DETAILED,
      messages: [{ role: 'user', content: [
        { type: 'text', text: userPrompt },
        { type: 'image', image: dataUri },
      ]}],
      temperature: 0.4, // um pouco mais criativo pra texto natural
      maxTokens: 800,
    });
    logStage('food_detailed_gemini_ok', Date.now() - t0, { provider: 'gemini' });
    if (text && text.trim().length > 20) {
      return { text: text.trim(), model: GEMINI_MODEL, parsed: null };
    }
  } catch (e) {
    logError('food_detailed_gemini_fail', e);
  }

  // Groq fallback
  try {
    const t0 = Date.now();
    const groq = getGroq();
    const { text } = await generateText({
      model: groq(GROQ_VISION_MODEL),
      system: SYSTEM_PROMPT_DETAILED,
      messages: [{ role: 'user', content: [
        { type: 'text', text: userPrompt },
        { type: 'image', image: dataUri },
      ]}],
      temperature: 0.4,
      maxTokens: 800,
    });
    logStage('food_detailed_groq_ok', Date.now() - t0, { provider: 'groq' });
    if (text && text.trim().length > 20) {
      return { text: text.trim(), model: GROQ_VISION_MODEL, parsed: null };
    }
  } catch (e) {
    logError('food_detailed_groq_fail', e);
  }

  return null;
}

/**
 * Helper: extrai e sanitiza JSON da resposta do LLM.
 * Tolerante a schemas diferentes — Gemini e Groq retornam nomes de campos
 * distintos. Procura variantes comuns e normaliza.
 *
 * Retorna null se LLM sinalizou `nao_e_comida` ou se parsing falhou.
 */
function parseRefeicaoJson(text: string): Omit<RefeicaoData, 'ai_model'> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  const jsonStr = match[0];

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    // Fallback: tentar encontrar o ÚLTIMO `}` que fecha o JSON completo.
    // Útil quando o LLM trunca a resposta por maxTokens.
    console.warn('[parseRefeicaoJson] JSON.parse falhou. Tentando fallback...');
    const lastBrace = text.lastIndexOf('}');
    if (lastBrace > 0) {
      try {
        parsed = JSON.parse(text.slice(0, lastBrace + 1));
        console.warn('[parseRefeicaoJson] Fallback OK');
      } catch {
        console.warn('[parseRefeicaoJson] Fallback também falhou');
        return null;
      }
    } else {
      return null;
    }
  }

  if (parsed.nao_e_comida === true) return null;

  // === TOLERÂNCIA A SCHEMAS DIFERENTES ===
  const itensRaw = Array.isArray(parsed.itens)
    ? parsed.itens
    : Array.isArray(parsed.alimentos_identificados)
      ? parsed.alimentos_identificados
      : Array.isArray(parsed.alimentos)
        ? parsed.alimentos
        : Array.isArray(parsed.foods)
          ? parsed.foods
          : [];

  if (itensRaw.length === 0) {
    const keys = Object.keys(parsed);
    console.warn('[parseRefeicaoJson] nenhum array de itens encontrado. Keys:', keys);
  }

  const itens = itensRaw
    .map((it: any): { nome: string; gramas: number; kcal: number; prot: number; carb: number; gord: number } | null => {
      if (typeof it === 'string') {
        return { nome: it.slice(0, 100).trim(), gramas: 0, kcal: 0, prot: 0, carb: 0, gord: 0 };
      }
      if (!it || typeof it !== 'object') return null;
      const nome = String(
        it.nome ?? it.nome_alimento ?? it.name ?? it.food ?? it.alimento ?? '',
      ).slice(0, 100).trim();
      const gramas = Number(
        it.gramas ?? it.quantidade_gramas ?? it.grams ?? it.portion ?? it.porcao_g ?? 0,
      ) || 0;
      const kcal = Number(
        it.kcal ?? it.calorias ?? it.calories ?? it.cal ?? 0,
      ) || 0;
      const prot = Number(
        it.prot ?? it.proteinas ?? it.protein ?? it.proteina_g ?? 0,
      ) || 0;
      const carb = Number(
        it.carb ?? it.carboidratos ?? it.carbs ?? it.carboidrato_g ?? 0,
      ) || 0;
      const gord = Number(
        it.gord ?? it.gorduras ?? it.fat ?? it.gordura_g ?? 0,
      ) || 0;
      return { nome, gramas, kcal, prot, carb, gord };
    })
    .filter((it: { nome: string } | null): it is { nome: string; gramas: number; kcal: number; prot: number; carb: number; gord: number } =>
      it !== null && it.nome.length > 0,
    )
    .slice(0, 20);

  if (itens.length === 0) return null;

  const totaisRaw = parsed.totais ?? parsed.valores_nutricionais_totais ?? parsed.total ?? parsed.nutrition ?? {};
  const kcal = Number(totaisRaw.kcal ?? totaisRaw.calorias ?? totaisRaw.calories ?? 0) || null;
  const protein_g = Number(totaisRaw.prot ?? totaisRaw.proteinas ?? totaisRaw.protein ?? 0) || null;
  const carb_g = Number(totaisRaw.carb ?? totaisRaw.carboidratos ?? totaisRaw.carbs ?? 0) || null;
  const fat_g = Number(totaisRaw.gord ?? totaisRaw.gorduras ?? totaisRaw.fat ?? 0) || null;
  const portion_g = Number(totaisRaw.portion_g ?? totaisRaw.porcao_total_g ?? 0) || null;

  const mealTypeRaw = String(
    parsed.meal_type ?? parsed.tipo_refeicao ?? parsed.meal ?? '',
  ).toLowerCase();
  const mealType: 'cafe' | 'almoco' | 'jantar' | 'lanche' | null =
    ['cafe', 'almoco', 'jantar', 'lanche'].includes(mealTypeRaw)
      ? (mealTypeRaw as 'cafe' | 'almoco' | 'jantar' | 'lanche')
      : null;

  const confidence = Number(parsed.confianca ?? parsed.confidence ?? parsed.score ?? 0.5) || 0.5;

  return {
    kcal,
    protein_g,
    carb_g,
    fat_g,
    portion_g,
    meal_type: mealType,
    confidence: Math.max(0, Math.min(1, confidence)),
    descricao_user: null,
    itens,
  };
}

/**
 * Heurística simples de meal_type baseado na hora BRT.
 * Usado como fallback se a IA não conseguir classificar.
 */
export function inferirMealType(hora: number): 'cafe' | 'almoco' | 'jantar' | 'lanche' {
  if (hora < 10) return 'cafe';
  if (hora < 15) return 'almoco';
  if (hora < 18) return 'lanche';
  return 'jantar';
}

/**
 * Detecta se o user pediu análise detalhada na legenda/caption
 * ou numa frase enviada junto.
 */
export function pedidoAnaliseDetalhada(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return /\b(nutricionista|analise\s+completa|analise\s+detalhada|avaliacao\s+completa|analisa\s+isso|faz\s+a\s+analise|analise\s+de\s+nutricionista)\b/.test(t);
}
