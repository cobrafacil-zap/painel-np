import { NextRequest, NextResponse } from 'next/server';
import { createClient, requireUser } from '@/lib/supabase/server';

/**
 * GET /api/financeiro/contas-moradia?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Retorna breakdown das contas fixas da casa (luz, água, internet, aluguel,
 * etc.) agrupadas por palavra-chave detectada no `description` ou `category`.
 *
 * Categorias consideradas "conta de moradia":
 *   - contas_casa: luz, água, gás, internet, telefone, celular, TV a cabo
 *   - moradia:     aluguel, condomínio, IPTU, financiamento imobiliário
 *
 * Saída:
 *   {
 *     total_mes: number,        // soma de todas as contas no período
 *     por_item: [               // agrupado por palavra-chave detectada
 *       { chave, label, total, count, ultima_vez }
 *     ],
 *     por_categoria: {          // total por categoria
 *       contas_casa: number,
 *       moradia: number
 *     }
 *   }
 */

// Palavras-chave (ordem importa — primeiro match ganha). Cobre contas
// recorrentes genéricas (sem nomes de fornecedores, conforme decisão).
const KEYWORDS: Array<{ chave: string; label: string; regex: RegExp }> = [
  { chave: 'luz',       label: 'Luz',        regex: /\b(luz|energia|el[eé]trica|conta\s+de\s+luz)\b/i },
  { chave: 'agua',      label: 'Água',       regex: /\b(agua|[áa]gua|sabesp|copasa|cedae|conta\s+de\s+(?:agua|[áa]gua))\b/i },
  { chave: 'gas',       label: 'Gás',        regex: /\b(g[aá]s|conta\s+de\s+g[aá]s|comg[aá]s)\b/i },
  { chave: 'internet',  label: 'Internet',   regex: /\b(internet|wifi|wi-fi|fibra|banda\s+larga|net\s+combo|net\b(?!\s+\w)|\bconta\s+de\s+net)/i },
  { chave: 'telefone',  label: 'Telefone',   regex: /\b(telefone|celular|plano\s+(?:de\s+)?(?:telefone|celular)|conta\s+de\s+(?:telefone|celular))\b/i },
  { chave: 'tv',        label: 'TV',         regex: /\b(tv\s+(?:a\s+cabo|por\s+assinatura)|tv\s+paga|tv\s+assinatura)\b/i },
  { chave: 'aluguel',   label: 'Aluguel',    regex: /\b(aluguel|renda|rent)\b/i },
  { chave: 'condominio',label: 'Condomínio', regex: /\b(condom[ií]nio|condominium)\b/i },
  { chave: 'iptu',      label: 'IPTU',       regex: /\b(iptu|imposto\s+predial)\b/i },
  { chave: 'financiamento', label: 'Financiamento', regex: /\b(financ[aã]mento\s+(?:imobili[aá]rio|casa|apartamento)|prestação\s+(?:da\s+casa|do\s+apto)|parcela\s+(?:da\s+casa|do\s+apto))\b/i },
];

function detectarChave(texto: string | null): string | null {
  if (!texto) return null;
  for (const kw of KEYWORDS) {
    if (kw.regex.test(texto)) return kw.chave;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const { userId } = await requireUser();
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const supabase = await createClient();
  let q = supabase
    .from('records')
    .select('type, amount, category, description, occurred_at')
    .eq('user_id', userId)
    .eq('module_id', 'financeiro')
    .in('category', ['contas_casa', 'moradia']);

  if (from) q = q.gte('occurred_at', from);
  if (to) q = q.lte('occurred_at', to);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).filter((r) => r.type === 'gasto');

  // Inicializa buckets com todas as keywords (mesmo sem gasto → mostra no card)
  const buckets: Record<string, { chave: string; label: string; total: number; count: number; ultima_vez: string | null }> = {};
  for (const kw of KEYWORDS) {
    buckets[kw.chave] = { chave: kw.chave, label: kw.label, total: 0, count: 0, ultima_vez: null };
  }

  let total_mes = 0;
  let total_contas_casa = 0;
  let total_moradia = 0;

  for (const r of rows) {
    const amt = Number(r.amount);
    total_mes += amt;
    if (r.category === 'contas_casa') total_contas_casa += amt;
    else if (r.category === 'moradia') total_moradia += amt;

    // Tenta detectar por description primeiro, depois por category (com fallback)
    const chave =
      detectarChave(r.description) ??
      // fallback: usa a própria categoria como chave genérica
      (r.category === 'moradia' ? 'aluguel' : 'contas_casa');

    // Se a chave é genérica e a keyword específica existe, agrupa na genérica
    // (ex: "moradia" sem keyword detectada vai pro bucket "aluguel" só se
    // não houver bucket mais específico — mas se a categoria é contas_casa
    // sem keyword, mantém agrupado numa chave própria "outros")
    let target = chave;
    if (!buckets[target]) {
      target = r.category === 'moradia' ? 'aluguel' : 'outros_contas_casa';
      buckets[target] = { chave: target, label: 'Outros', total: 0, count: 0, ultima_vez: null };
    }

    const b = buckets[target]!;
    b.total += amt;
    b.count += 1;
    if (!b.ultima_vez || (r.occurred_at && r.occurred_at > b.ultima_vez)) {
      b.ultima_vez = r.occurred_at;
    }
  }

  // Ordena por total desc, só retorna os que tiveram gasto
  const por_item = Object.values(buckets)
    .filter((b) => b.count > 0)
    .sort((a, b) => b.total - a.total);

  return NextResponse.json({
    total_mes,
    por_categoria: {
      contas_casa: total_contas_casa,
      moradia: total_moradia,
    },
    por_item,
  });
}
