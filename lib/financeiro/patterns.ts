/**
 * Cálculo e inferência de padrões de gastos do usuário.
 *
 * Algoritmo:
 * 1. Busca records do user nos últimos 90 dias
 * 2. Agrupa por (category, keyword_detectada_no_description)
 * 3. Calcula média, desvio padrão, dia típico do mês, count
 * 4. Se count >= 2 e gap entre ocorrências sugere recorrência (mensal/semanal),
 *    cria/atualiza pattern
 * 5. Estima next_expected_date (próximo mês, mesmo dia)
 */

import { createServiceClient } from '@/lib/supabase/server';

// Mesmas keywords do /api/financeiro/contas-moradia
const KEYWORDS: Array<{ chave: string; regex: RegExp }> = [
  { chave: 'luz',          regex: /\b(luz|energia|el[eé]trica|conta\s+de\s+luz)\b/i },
  { chave: 'agua',         regex: /\b(agua|[áa]gua|conta\s+de\s+(?:agua|[áa]gua))\b/i },
  { chave: 'gas',          regex: /\b(g[aá]s|conta\s+de\s+g[aá]s)\b/i },
  { chave: 'internet',     regex: /\b(internet|wifi|wi-fi|fibra|banda\s+larga|net\s+combo|net\b|\bconta\s+de\s+net)\b/i },
  { chave: 'telefone',     regex: /\b(telefone|celular|plano\s+(?:de\s+)?(?:telefone|celular)|conta\s+de\s+(?:telefone|celular))\b/i },
  { chave: 'tv',           regex: /\b(tv\s+(?:a\s+cabo|por\s+assinatura)|tv\s+paga|tv\s+assinatura)\b/i },
  { chave: 'aluguel',      regex: /\b(aluguel|renda|rent)\b/i },
  { chave: 'condominio',   regex: /\b(condom[ií]nio)\b/i },
  { chave: 'iptu',         regex: /\b(iptu|imposto\s+predial)\b/i },
  { chave: 'netflix',      regex: /\b(netflix)\b/i },
  { chave: 'spotify',      regex: /\b(spotify)\b/i },
  { chave: 'academia',     regex: /\b(academia)\b/i },
  { chave: 'plano_saude',  regex: /\b(plano\s+de\s+sa[úu]de|convenio|conv[eê]nio)\b/i },
];

export function detectarKeyword(texto: string | null | undefined): string | null {
  if (!texto) return null;
  for (const kw of KEYWORDS) {
    if (kw.regex.test(texto)) return kw.chave;
  }
  return null;
}

interface RawRecord {
  type: string;
  amount: number;
  category: string | null;
  description: string | null;
  occurred_at: string;
}

interface PatternAggregate {
  chave: string;
  category: string | null;
  amounts: number[];
  days: number[];
  dates: string[];
}

interface CalculatedPattern {
  pattern_key: string;
  pattern_type: 'recurring_fixed' | 'recurring_variable' | 'avg_spend';
  avg_amount: number;
  stddev_amount: number;
  day_of_month: number | null;
  frequency: 'monthly' | 'weekly' | 'irregular';
  sample_count: number;
  last_seen_at: string;
  next_expected_date: string | null;
  next_expected_amount: number | null;
}

function dayDiff(isoA: string, isoB: string): number {
  const a = new Date(isoA + 'T00:00:00').getTime();
  const b = new Date(isoB + 'T00:00:00').getTime();
  return Math.round((b - a) / 86400000);
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * Recebe os records já carregados e devolve os patterns calculados.
 * Pura — não toca no banco.
 */
export function calcularPadroes(records: RawRecord[]): CalculatedPattern[] {
  // Filtra só gastos
  const gastos = records.filter((r) => r.type === 'gasto');

  // Agrupa por (category, keyword)
  const buckets = new Map<string, PatternAggregate>();
  for (const r of gastos) {
    const kw = detectarKeyword(r.description) ?? detectarKeyword(r.category);
    const chave = kw ? `${r.category ?? 'outros'}:${kw}` : `${r.category ?? 'outros'}:geral`;
    if (!buckets.has(chave)) {
      buckets.set(chave, { chave, category: r.category, amounts: [], days: [], dates: [] });
    }
    const b = buckets.get(chave)!;
    b.amounts.push(Number(r.amount));
    b.days.push(parseInt(r.occurred_at.slice(8, 10), 10));
    b.dates.push(r.occurred_at);
  }

  const hoje = new Date();
  const patterns: CalculatedPattern[] = [];

  for (const b of buckets.values()) {
    if (b.amounts.length < 2) continue; // precisa de >=2 amostras

    // Ordena por data
    const ordenados = b.dates
      .map((d, i) => ({ date: d, amount: b.amounts[i], day: b.days[i] }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Calcula gaps entre datas pra detectar frequência
    const gaps: number[] = [];
    for (let i = 1; i < ordenados.length; i++) {
      gaps.push(dayDiff(ordenados[i - 1].date, ordenados[i].date));
    }
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;

    // Decide frequência
    let frequency: 'monthly' | 'weekly' | 'irregular';
    if (avgGap >= 6 && avgGap <= 10) frequency = 'weekly';
    else if (avgGap >= 25 && avgGap <= 35) frequency = 'monthly';
    else if (avgGap >= 85 && avgGap <= 95) frequency = 'monthly';
    else frequency = 'irregular';

    // Decide tipo
    const avgAmount = b.amounts.reduce((s, v) => s + v, 0) / b.amounts.length;
    const stddevAmount = stddev(b.amounts);
    const coefVariacao = avgAmount > 0 ? stddevAmount / avgAmount : 0;

    let patternType: 'recurring_fixed' | 'recurring_variable' | 'avg_spend';
    if (frequency === 'monthly' && coefVariacao < 0.2) patternType = 'recurring_fixed';
    else if (frequency === 'monthly') patternType = 'recurring_variable';
    else patternType = 'avg_spend';

    // Dia do mês típico (mediano pra evitar outlier)
    const sortedDays = [...b.days].sort((a, c) => a - c);
    const medianDay = sortedDays[Math.floor(sortedDays.length / 2)];

    // Próxima data prevista
    const ultimaData = ordenados[ordenados.length - 1].date;
    let nextExpected: string | null = null;
    if (frequency === 'monthly') {
      const [y, m, d] = ultimaData.split('-').map(Number);
      const targetDay = Math.min(medianDay, 28); // evita problema de dia 31 em mês com 30
      const nextMonth = m === 12 ? 1 : m + 1;
      const nextYear = m === 12 ? y + 1 : y;
      nextExpected = `${nextYear}-${pad(nextMonth)}-${pad(targetDay)}`;
    } else if (frequency === 'weekly') {
      const next = new Date(ultimaData + 'T00:00:00');
      next.setDate(next.getDate() + 7);
      nextExpected = next.toISOString().slice(0, 10);
    }

    patterns.push({
      pattern_key: b.chave,
      pattern_type: patternType,
      avg_amount: Math.round(avgAmount * 100) / 100,
      stddev_amount: Math.round(stddevAmount * 100) / 100,
      day_of_month: frequency === 'monthly' ? medianDay : null,
      frequency,
      sample_count: b.amounts.length,
      last_seen_at: ultimaData + 'T00:00:00Z',
      next_expected_date: nextExpected,
      next_expected_amount: Math.round(avgAmount * 100) / 100,
    });
  }

  return patterns;
}

/**
 * Job que recalcula patterns de todos os users ativos.
 * Idempotente: UPSERT por (user_id, pattern_key).
 */
export async function jobCalcularPadroes(): Promise<{ users: number; patterns: number }> {
  const supabase = createServiceClient();

  // Busca users ativos (com records nos últimos 90 dias)
  const noventaAtras = new Date();
  noventaAtras.setDate(noventaAtras.getDate() - 90);
  const desdeISO = noventaAtras.toISOString().slice(0, 10);

  const { data: usersAtivos } = await supabase
    .from('records')
    .select('user_id')
    .eq('module_id', 'financeiro')
    .gte('occurred_at', desdeISO)
    .limit(10000);

  const userIds = Array.from(new Set((usersAtivos ?? []).map((u) => u.user_id)));
  if (userIds.length === 0) return { users: 0, patterns: 0 };

  let totalPatterns = 0;
  for (const userId of userIds) {
    const { data: records } = await supabase
      .from('records')
      .select('type, amount, category, description, occurred_at')
      .eq('user_id', userId)
      .eq('module_id', 'financeiro')
      .gte('occurred_at', desdeISO);

    const patterns = calcularPadroes((records ?? []) as RawRecord[]);
    if (patterns.length === 0) continue;

    // UPSERT em batch
    const rows = patterns.map((p) => ({
      user_id: userId,
      pattern_key: p.pattern_key,
      pattern_type: p.pattern_type,
      avg_amount: p.avg_amount,
      stddev_amount: p.stddev_amount,
      day_of_month: p.day_of_month,
      frequency: p.frequency,
      sample_count: p.sample_count,
      last_seen_at: p.last_seen_at,
      next_expected_date: p.next_expected_date,
      next_expected_amount: p.next_expected_amount,
    }));

    const { error } = await supabase
      .from('user_patterns')
      .upsert(rows, { onConflict: 'user_id,pattern_key' });

    if (!error) totalPatterns += rows.length;
    else console.warn('[calcularPadroes] upsert error:', error.message);
  }

  return { users: userIds.length, patterns: totalPatterns };
}

/**
 * Lê os patterns do user pra injetar no system prompt do Groq.
 */
export async function carregarPadroesParaContexto(userId: string): Promise<string> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('user_patterns')
    .select('pattern_key, pattern_type, avg_amount, day_of_month, frequency, sample_count, next_expected_date, next_expected_amount')
    .eq('user_id', userId)
    .order('sample_count', { ascending: false })
    .limit(8);

  if (!data || data.length === 0) return '';

  const linhas = data.map((p) => {
    const valor = p.next_expected_amount
      ? `~R$ ${Number(p.next_expected_amount).toFixed(0)}`
      : `~R$ ${Number(p.avg_amount).toFixed(0)}`;
    const dia = p.day_of_month ? ` dia ${p.day_of_month}` : '';
    const freq =
      p.frequency === 'monthly' ? 'mensal' : p.frequency === 'weekly' ? 'semanal' : 'irregular';
    return `- ${p.pattern_key}: ${valor}${dia} (${freq}, ${p.sample_count} amostras)`;
  });

  return `\n\nMEMÓRIA DO USUÁRIO (padrões observados nos últimos 90 dias):\n${linhas.join('\n')}`;
}

/**
 * Lista os N patterns mais prováveis de aparecer nos próximos 30 dias.
 */
export async function listarPadroesFuturos(userId: string, limite = 5) {
  const supabase = createServiceClient();
  const hoje = new Date();
  const trintaDias = new Date();
  trintaDias.setDate(trintaDias.getDate() + 30);

  const { data } = await supabase
    .from('user_patterns')
    .select('*')
    .eq('user_id', userId)
    .not('next_expected_date', 'is', null)
    .lte('next_expected_date', trintaDias.toISOString().slice(0, 10))
    .gte('next_expected_date', hoje.toISOString().slice(0, 10))
    .order('next_expected_date', { ascending: true })
    .limit(limite);

  return data ?? [];
}
