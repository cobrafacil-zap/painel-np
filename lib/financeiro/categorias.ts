/**
 * Auto-categorização (#overhaul).
 *
 * Quando o parser retorna `category=null` OU o slug não existe em
 * `categories`, criamos uma nova categoria automaticamente:
 *   1. `suggestCategoryFromText(texto)` chama Groq pra extrair slug+label
 *      ou null se incerto.
 *   2. `ensureCategory(userId, slug, label)` faz UPSERT idempotente em
 *      `categories` (onConflict: user_id,module_id,slug).
 *   3. Se Groq falhou, fallback: slug = `cat_<timestamp>`, label = "Nova
 *      categoria".
 *
 * Não bloqueia: erros viram log warn e o lançamento segue com
 * `category=null` (comportamento legado). O `metadata.auto_category=true`
 * é gravado pra rastreabilidade.
 */

import { generateText } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { createServiceClient } from '@/lib/supabase/server';
import { recordParserStage } from '@/lib/parser-stats';
import { logStage, logError, logDebug } from '@/lib/log';

let _groq: ReturnType<typeof createGroq> | null = null;
function getGroq() {
  if (_groq) return _groq;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY não configurada');
  _groq = createGroq({ apiKey });
  return _groq;
}

export interface CategorySuggestion {
  slug: string;
  label: string;
}

/**
 * Sugere categoria a partir do texto via Groq. Retorna null se incerto.
 *
 * Estratégia: prompt mínimo pedindo slug em snake_case + label curto.
 * Considera categorias existentes pra evitar duplicar (festas vs lazer).
 */
export async function suggestCategoryFromText(
  texto: string,
  categoriasExistentes: string[] = [],
): Promise<CategorySuggestion | null> {
  try {
    const lista = categoriasExistentes.length > 0
      ? `\n\nCATEGORIAS JÁ EXISTENTES (use uma dessas se fizer sentido): ${categoriasExistentes.join(', ')}.`
      : '';

    const groq = getGroq();
    const t0 = Date.now();
    const { text } = await generateText({
      model: groq('llama-3.1-8b-instant'),
      system:
        'Você sugere categoria financeira (slug + label) a partir de um gasto descrito em português brasileiro. ' +
        'Responda APENAS JSON puro: {"slug": "snake_case_max_60_chars", "label": "Label Curto", "confidence": 0..1}. ' +
        'Se incerto (não dá pra classificar com confiança), retorne {"slug": null, "label": null, "confidence": 0}.' +
        lista,
      prompt: `Gasto: "${texto}".\n\nConsidere: tipo de gasto (lazer, festa, assinatura, hobby, trabalho, etc). Se for similar a uma categoria existente, use o slug dela. Caso contrário crie slug descritivo curto (ex: "festas" para show/ingresso/festa; "pets" para veterinário/ração; "doacoes" para doação).`,
      temperature: 0.2,
      maxTokens: 100,
    });
    logStage('categoria_suggest', Date.now() - t0);

    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!parsed.slug || !parsed.label || (parsed.confidence ?? 0) < 0.7) {
      return null;
    }

    // Sanitiza slug: snake_case, sem acento, max 60 chars
    const slug = parsed.slug
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 60);

    if (!slug) return null;

    return { slug, label: String(parsed.label).slice(0, 60) };
  } catch (e) {
    logError('categoria_suggest', e);
    return null;
  }
}

/**
 * Garante que a categoria existe no banco. Cria se não existir (com
 * is_system=false, ícone Package, cor zinc). Retorna a categoria
 * (existente ou nova).
 */
export async function ensureCategory(
  userId: string,
  slug: string,
  label: string,
  moduleId: string = 'financeiro',
): Promise<{ id: string; slug: string; label: string } | null> {
  try {
    const supabase = createServiceClient();

    // Tenta SELECT primeiro pra evitar INSERT wasted
    const { data: existing } = await supabase
      .from('categories')
      .select('id, slug, label')
      .eq('user_id', userId)
      .eq('module_id', moduleId)
      .eq('slug', slug)
      .maybeSingle();

    if (existing) {
      return { id: existing.id, slug: existing.slug, label: existing.label };
    }

    // Não existe → cria
    const { data: created, error } = await supabase
      .from('categories')
      .insert({
        user_id: userId,
        module_id: moduleId,
        slug,
        label,
        icon: 'Package',
        color: 'zinc',
        is_system: false,
      })
      .select('id, slug, label')
      .single();

    if (error) {
      // Se foi race condition e outro request criou antes: re-fetch
      if (error.code === '23505') {
        const { data: refetched } = await supabase
          .from('categories')
          .select('id, slug, label')
          .eq('user_id', userId)
          .eq('module_id', moduleId)
          .eq('slug', slug)
          .maybeSingle();
        if (refetched) {
          return { id: refetched.id, slug: refetched.slug, label: refetched.label };
        }
      }
      logError('categoria_ensure_insert', error, { slug });
      return null;
    }

    recordParserStage('auto_category_created');
    logStage('categoria_created', undefined, { slug, label });
    return { id: created.id, slug: created.slug, label: created.label };
  } catch (e) {
    logError('categoria_ensure', e, { slug });
    return null;
  }
}

/**
 * Helper all-in-one: tenta categorizar o texto e garante a categoria no
 * banco. Retorna o slug final (existente ou novo) ou null se falhou.
 *
 * Use no webhook quando `parsed.category` é null OU o slug não existe
 * em `categories`.
 */
export async function autoCategorize(
  userId: string,
  textoOriginal: string,
  slugSugerido: string | null,
): Promise<{ slug: string; isNew: boolean } | null> {
  recordParserStage('auto_category_skipped'); // marca skipped por padrão

  // 1. Carrega categorias existentes pra ajudar Groq
  const supabase = createServiceClient();
  const { data: cats } = await supabase
    .from('categories')
    .select('slug')
    .eq('user_id', userId)
    .eq('module_id', 'financeiro')
    .order('is_system', { ascending: false });

  const slugs = (cats ?? []).map((c: any) => c.slug);

  // 2. Se parser já deu slug e ele existe, retorna direto (sem Groq)
  if (slugSugerido && slugs.includes(slugSugerido)) {
    return { slug: slugSugerido, isNew: false };
  }

  // 3. Pede sugestão ao Groq (considera existentes pra evitar dup)
  const suggestion = await suggestCategoryFromText(textoOriginal, slugs);

  let finalSlug: string;
  let finalLabel: string;
  let isNew = false;

  if (suggestion && slugs.includes(suggestion.slug)) {
    // Groq sugeriu algo que já existe → usa existente
    finalSlug = suggestion.slug;
    finalLabel = suggestion.label;
  } else if (suggestion) {
    // Groq sugeriu algo novo → cria
    finalSlug = suggestion.slug;
    finalLabel = suggestion.label;
    isNew = true;
  } else {
    // Groq falhou → fallback timestamp
    finalSlug = slugSugerido || `cat_${Date.now()}`;
    finalLabel = 'Nova categoria';
    isNew = !slugs.includes(finalSlug);
  }

  // 4. Garante que existe no banco
  const ensured = await ensureCategory(userId, finalSlug, finalLabel);
  if (!ensured) {
    logDebug('categoria_auto_failed', { slug: finalSlug });
    return null;
  }

  return { slug: ensured.slug, isNew };
}
