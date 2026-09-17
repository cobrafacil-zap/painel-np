/**
 * Parser de mensagem livre do WhatsApp → JSON estruturado.
 *
 * Usa Groq (modelo llama-3.3-70b-versatile / gpt-oss-120b, free tier).
 * Poucas chamadas por mensagem, então mesmo no free tier sobra.
 */

import { generateText } from 'ai';
import { createGroq } from '@ai-sdk/groq';

export type ParsedIntent =
  | {
      intent: 'lancamento';
      confidence: number;
      type: 'gasto' | 'receita';
      amount: number;
      category: string | null;
      description: string | null;
      payment_method: string | null;
      occurred_at: string | null; // 'YYYY-MM-DD' ou null = hoje
    }
  | {
      intent: 'compromisso';
      confidence: number;
      tipo: 'pagar' | 'receber';
      descricao: string;
      valor_total: number;
      total_parcelas: number;
      recorrencia: 'unica' | 'semanal' | 'mensal' | 'anual';
      data_primeira: string | null;
    }
  | {
      intent: 'consulta';
      confidence: number;
      tipo: 'gastos' | 'receitas' | 'saldo' | 'top_categoria' | 'compromissos' | 'parcelas';
      periodo: 'hoje' | 'semana' | 'mes' | 'mes_passado' | 'tudo';
      categoria: string | null;
    }
  | {
      intent: 'acao';
      confidence: number;
      acao: 'apagar_ultimo' | 'apagar_categoria' | 'pagar_parcela';
      alvo: string | null;
    }
  | {
      intent: 'outro';
      confidence: number;
    };

const SYSTEM_PROMPT = `Você é o parser de mensagens de um painel financeiro pessoal brasileiro.
Responda SEMPRE em JSON puro (sem markdown, sem comentários, sem texto antes/depois).

CATEGORIAS (use o slug quando tiver certeza; senão devolva null):
mercado, transporte, alimentacao, moradia, saude, lazer, educacao,
assinaturas, freelance, salario, investimentos, posto, cartao_credito, outros

FORMAS DE PAGAMENTO (slug):
pix, cartao_credito, cartao_debito, dinheiro, boleto, transferencia

INTENÇÕES:
- lancamento: registro simples (gasto/receita). Ex: "gastei 50 no mercado".
- compromisso: dívida, empréstimo, conta futura, parcelamento. Ex: "peguei 800, 4x de 200".
- consulta: pergunta sobre dados. Ex: "quanto gastei?", "o que tenho pra pagar?".
- acao: comando destrutivo. Ex: "apagar último", "pagar parcela 2".
- outro: cumprimentos, dúvidas, frases sem dados suficientes.

SAÍDA (JSON ESTRITO, NADA MAIS):
{
  "intent": "lancamento|compromisso|consulta|acao|outro",
  "confidence": number 0..1,
  // lancamento:
  "type": "gasto|receita",
  "amount": number,
  "category": string|null,
  "description": string|null,
  "payment_method": string|null,
  "occurred_at": string|null,
  // compromisso:
  "tipo": "pagar|receber",
  "descricao": string,
  "valor_total": number,
  "total_parcelas": number,
  "recorrencia": "unica|semanal|mensal|anual",
  "data_primeira": string|null,
  // consulta:
  "tipo": "gastos|receitas|saldo|top_categoria|compromissos|parcelas",
  "periodo": "hoje|semana|mes|mes_passado|tudo",
  "categoria": string|null,
  // acao:
  "acao": "apagar_ultimo|apagar_categoria|pagar_parcela",
  "alvo": string|null
}

═══════════════════════════════════════════════
EXEMPLOS DE LANÇAMENTO
═══════════════════════════════════════════════

"gastei 50 no mercado" → {"intent":"lancamento","confidence":0.97,"type":"gasto","amount":50,"category":"mercado","description":"mercado","payment_method":null,"occurred_at":null}
"recebi 1500 de freelance" → {"intent":"lancamento","confidence":0.96,"type":"receita","amount":1500,"category":"freelance","description":"freelance","payment_method":null,"occurred_at":null}
"almoço 35 no ifood pix" → {"intent":"lancamento","confidence":0.93,"type":"gasto","amount":35,"category":"alimentacao","description":"almoço no ifood","payment_method":"pix","occurred_at":null}
"paguei 1200 de aluguel dia 5" → {"intent":"lancamento","confidence":0.95,"type":"gasto","amount":1200,"category":"moradia","description":"aluguel","payment_method":null,"occurred_at":null}
"Gastei 13 no posto de gasolina" → {"intent":"lancamento","confidence":0.95,"type":"gasto","amount":13,"category":"posto","description":"posto de gasolina","payment_method":null,"occurred_at":null}
"coloquei 50 de gasolina" → {"intent":"lancamento","confidence":0.95,"type":"gasto","amount":50,"category":"posto","description":"gasolina","payment_method":null,"occurred_at":null}
"comprei 30 de mercado" → {"intent":"lancamento","confidence":0.95,"type":"gasto","amount":30,"category":"mercado","description":"mercado","payment_method":null,"occurred_at":null}
"paguei 80 de conta de luz" → {"intent":"lancamento","confidence":0.94,"type":"gasto","amount":80,"category":"moradia","description":"conta de luz","payment_method":null,"occurred_at":null}
"salário 7500 caiu" → {"intent":"lancamento","confidence":0.94,"type":"receita","amount":7500,"category":"salario","description":"salário","payment_method":null,"occurred_at":null}
"recebi 100 do cliente" → {"intent":"lancamento","confidence":0.93,"type":"receita","amount":100,"category":"freelance","description":"cliente","payment_method":null,"occurred_at":null}
"uber pro trabalho 25" → {"intent":"lancamento","confidence":0.93,"type":"gasto","amount":25,"category":"transporte","description":"uber pro trabalho","payment_method":null,"occurred_at":null}

═══════════════════════════════════════════════
EXEMPLOS DE COMPROMISSO (frases longas e naturais)
═══════════════════════════════════════════════

"Peguei 200 com a priscila para pagar o Mac tenho que pagar em uma vez amanhã" →
{"intent":"compromisso","confidence":0.93,"tipo":"pagar","descricao":"empréstimo priscila para Mac","valor_total":200,"total_parcelas":1,"recorrencia":"unica","data_primeira":"AMANHA"}

"Peguei 200 reais emprestados com a Priscila, preciso pagar dia 17" →
{"intent":"compromisso","confidence":0.94,"tipo":"pagar","descricao":"empréstimo Priscila","valor_total":200,"total_parcelas":1,"recorrencia":"unica","data_primeira":"DIA_17"}

"peguei 800 com minha mae, pagar 200 por mes" →
{"intent":"compromisso","confidence":0.96,"tipo":"pagar","descricao":"empréstimo mãe","valor_total":800,"total_parcelas":4,"recorrencia":"mensal","data_primeira":null}

"emprestei 500 pro joao em 2x" →
{"intent":"compromisso","confidence":0.95,"tipo":"receber","descricao":"empréstimo João","valor_total":500,"total_parcelas":2,"recorrencia":"mensal","data_primeira":null}

"recebi 300 emprestado do pai" →
{"intent":"compromisso","confidence":0.94,"tipo":"pagar","descricao":"empréstimo pai","valor_total":300,"total_parcelas":1,"recorrencia":"unica","data_primeira":null}

"comprei um celular de 1500 em 10x" →
{"intent":"compromisso","confidence":0.93,"tipo":"pagar","descricao":"celular","valor_total":1500,"total_parcelas":10,"recorrencia":"mensal","data_primeira":null}

"fatura do cartao 1500 vence dia 20" →
{"intent":"compromisso","confidence":0.94,"tipo":"pagar","descricao":"fatura cartão","valor_total":1500,"total_parcelas":1,"recorrencia":"unica","data_primeira":"DIA_20"}

"vou pagar o aluguel 1200 dia 10" →
{"intent":"compromisso","confidence":0.92,"tipo":"pagar","descricao":"aluguel","valor_total":1200,"total_parcelas":1,"recorrencia":"unica","data_primeira":"DIA_10"}

"divida do carro 5000 em 12 parcelas" →
{"intent":"compromisso","confidence":0.93,"tipo":"pagar","descricao":"dívida carro","valor_total":5000,"total_parcelas":12,"recorrencia":"mensal","data_primeira":null}

═══════════════════════════════════════════════
EXEMPLOS DE CONSULTA
═══════════════════════════════════════════════

"quanto gastei esse mês?" → {"intent":"consulta","confidence":0.99,"tipo":"gastos","periodo":"mes","categoria":null}
"qual meu saldo?" → {"intent":"consulta","confidence":0.99,"tipo":"saldo","periodo":"tudo","categoria":null}
"o que tenho pra pagar?" → {"intent":"consulta","confidence":0.97,"tipo":"compromissos","periodo":"tudo","categoria":null}
"quais minhas parcelas esse mes?" → {"intent":"consulta","confidence":0.95,"tipo":"parcelas","periodo":"mes","categoria":null}
"top categoria de gasto do mês" → {"intent":"consulta","confidence":0.95,"tipo":"top_categoria","periodo":"mes","categoria":null}

═══════════════════════════════════════════════
EXEMPLOS DE AÇÃO
═══════════════════════════════════════════════

"apagar último" → {"intent":"acao","confidence":0.95,"acao":"apagar_ultimo","alvo":null}
"apaga o ultimo gasto" → {"intent":"acao","confidence":0.95,"acao":"apagar_ultimo","alvo":null}
"remover o gasto do posto" → {"intent":"acao","confidence":0.92,"acao":"apagar_categoria","alvo":"posto"}
"apagar tudo do mercado" → {"intent":"acao","confidence":0.93,"acao":"apagar_categoria","alvo":"mercado"}
"pagar parcela 2 da mae" → {"intent":"acao","confidence":0.93,"acao":"pagar_parcela","alvo":"mãe:2"}

"oi" → {"intent":"outro","confidence":0.98}

═══════════════════════════════════════════════
REGRAS CRÍTICAS (NUNCA ESQUEÇA)
═══════════════════════════════════════════════

• VALOR: SEMPRE positivo (o sinal vem de "type" ou "tipo").
• MÚLTIPLOS VALORES: se a frase tiver vários números, o valor_total é o primeiro valor monetário razoável. Ignore "uma vez", "duas vezes" como valor monetário.
• "uma vez" / "parcela única" / "sem dividir" / "à vista" → total_parcelas=1.
• "em 4x" / "em 4 vezes" / "4 parcelas" → total_parcelas=N.
• DATAS: use tokens no campo data_primeira: "HOJE", "AMANHA", "DIA_5" até "DIA_31" se o usuário disser dia específico do mês. null se não disser.
• "peguei"/"tirei" + ("emprestado"|"emprestimo"|"com a"|"com o"|"para pagar") → tipo=pagar.
• "emprestei"/"dei emprestado" → tipo=receber.
• "faturei"/"comprei parcelado"/"parcelei" → tipo=pagar.
• Datas relativas sem dia ("amanhã", "semana que vem", "mês que vem") → null (sistema calcula).
• Se a frase tiver verbo financeiro (gastei/paguei/recebi/ganhei/comprei/peguei/emprestei) E um valor monetário, é "lancamento" OU "compromisso" — NUNCA "outro".
• CONFIDENCE: 0.95+ para casos claros. 0.7-0.9 se tem ambiguidade. <0.7 só se realmente não dá pra saber.
• NÃO escreva markdown, comentários, explicações — SOMENTE o JSON.
• NÃO use aspas escapadas inválidas. Use aspas duplas normais.

LEMBRE-SE: você DEVE devolver um JSON válido E SOMENTE JSON. Sem "Aqui está o JSON:", sem markdown. APENAS {...}.`;

/**
 * Pré-parser local (regex) para casos óbvios e comandos curtos.
 * Para frases longas/complexas, retorna null e deixa o Groq decidir.
 */
function tentarParseLocal(texto: string): ParsedIntent | null {
  const t = texto.trim();
  if (!t) return null;

  const tl = t.toLowerCase();

  // === Comandos de apagar (alta confiança) ===
  if (/^(apagar|apaga|remover|remove|deletar|deleta|tirar|tira)\s+(o\s+)?(último|ultimo)/i.test(tl)) {
    return { intent: 'acao', confidence: 0.96, acao: 'apagar_ultimo', alvo: null };
  }
  const catDelMatch = tl.match(/^(?:apagar|apaga|remover|remove|deletar|deleta)\s+(?:tudo\s+)?(?:de|do|da)\s+(\w+)/);
  if (catDelMatch) {
    return { intent: 'acao', confidence: 0.92, acao: 'apagar_categoria', alvo: catDelMatch[1] };
  }

  // === Pagar parcela ===
  const parcMatch = tl.match(/^pagar?\s+(?:a\s+)?parcela\s+(\d+)\s+(?:de|do|da)\s+(.+)$/);
  if (parcMatch) {
    return { intent: 'acao', confidence: 0.93, acao: 'pagar_parcela', alvo: `${parcMatch[2].trim()}:${parcMatch[1]}` };
  }

  // === Consultas curtas ===
  if (/^(o\s+que|quais?|quanto|qual|me\s+mostra|me\s+diz)\b/.test(tl)) {
    if (/pra\s+pagar|para\s+pagar|tenho\s+que\s+pagar|contas\s+a\s+pagar|devo\b/.test(tl)) {
      return { intent: 'consulta', confidence: 0.97, tipo: 'compromissos', periodo: 'tudo', categoria: null };
    }
    if (/parcela/.test(tl)) {
      return { intent: 'consulta', confidence: 0.95, tipo: 'parcelas', periodo: 'mes', categoria: null };
    }
    if (/saldo/.test(tl)) {
      return { intent: 'consulta', confidence: 0.97, tipo: 'saldo', periodo: 'tudo', categoria: null };
    }
    if (/gast[ei]|gastos/.test(tl)) {
      let periodo: any = 'mes';
      if (/hoje/.test(tl)) periodo = 'hoje';
      else if (/semana/.test(tl)) periodo = 'semana';
      else if (/m[êe]s\s+passado/.test(tl)) periodo = 'mes_passado';
      else if (/tudo|total|geral/.test(tl)) periodo = 'tudo';
      return { intent: 'consulta', confidence: 0.95, tipo: 'gastos', periodo, categoria: null };
    }
    if (/receb[ei]|receitas/.test(tl)) {
      return { intent: 'consulta', confidence: 0.94, tipo: 'receitas', periodo: 'mes', categoria: null };
    }
    if (/top|maior|mais\s+gast/.test(tl)) {
      return { intent: 'consulta', confidence: 0.93, tipo: 'top_categoria', periodo: 'mes', categoria: null };
    }
  }

  // Pra frases muito longas (>200 chars) ou com várias cláusulas totalmente sem
  // palavra-chave forte, deixa o Groq decidir.
  if (t.length > 200) return null;

  // === Detectar valor monetário (suporta R$, ponto-e-vírgula BR) ===
  // IMPORTANTE: ordem das alternativas importa — o motor de regex do JS
  // pega a PRIMEIRA que casar, então colocamos primeiro o "número inteiro
  // com 4+ dígitos" (ex: "1650") pra ele não cair no "1.650" como se fosse
  // grupo de milhar mal formado, e nem parar nos primeiros 3 dígitos ("165").
  // Estratégia: tentar do mais específico pro mais genérico.
  // O grupo de captura inclui a parte decimal (,dd ou .dd) pra não perder centavos.
  const valorMatch =
    // 1) R$ + número (1-3 dígitos com pontos + ,centavos OU inteiro)
    t.match(/R\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d{4,}(?:[,\.]\d{2})?|\d{1,3}(?:[,\.]\d{2})?)/) ||
    // 2) Número "puro" com 4+ dígitos seguidos (ex: "1650", "1234,56")
    t.match(/\b(\d{4,}(?:[,\.]\d{2})?)\b/) ||
    // 3) Número com pontos de milhar (ex: "1.650" ou "1.650,50")
    t.match(/\b(\d{1,3}(?:\.\d{3})+(?:,\d{2})?)\b/) ||
    // 4) Número simples com 1-3 dígitos (com ou sem centavos: "50", "1,65")
    t.match(/\b(\d{1,3}(?:[,\.]\d{2})?)\b/);

  if (!valorMatch) return null;
  let valorStr = valorMatch[1];
  // Se tem 2 dígitos depois de , ou . é centavos. Remove pontos de milhar.
  let valor = parseFloat(valorStr.replace(/\./g, '').replace(',', '.'));
  if (!isFinite(valor) || valor <= 0 || valor > 1_000_000) return null;

  // === Compromissos: precisa de palavra-chave forte ===
  const ehEmprestimoPego = /\b(peguei|tirei|consegui|recebi)\b[^.!?]*\b(emprestado|empr[eé]stimo|com\s+(?:a|o|minha|meu|um|uma)|pra\s+pagar|para\s+pagar|tenho\s+(?:que\s+)?(?:pagar|devolver|quitar)|preciso\s+pagar|vou\s+pagar|devolver\s+(?:pra|para))/i.test(t);
  const ehEmprestimoDado = /\b(emprestei|dei\s+emprestado|emprestei\s+(?:pro|para|ao|à))/i.test(t);
  const ehParcelado = /\b(faturei|fatura\s+(?:de|do|da)|comprei\s+parcelado|parcelei|em\s+\d+\s*x|em\s+\d+\s+vezes|\d+\s+parcelas?|\d+\s*x\s+de)/i.test(t);

  if (ehEmprestimoPego || ehEmprestimoDado || ehParcelado) {
    const tipo: 'pagar' | 'receber' = ehEmprestimoDado ? 'receber' : 'pagar';

    // Parcelas
    let totalParcelas = 1;
    let valorParcela: number | null = null;
    let valorTotal = valor;

    const nx = t.match(/\b(?:em\s+)?(\d+)\s*x\b/i);
    const nvz = t.match(/\b(\d+)\s+vezes\b/i);
    const nparc = t.match(/\b(\d+)\s+parcelas?\b/i);
    if (nx) totalParcelas = parseInt(nx[1], 10);
    else if (nvz) totalParcelas = parseInt(nvz[1], 10);
    else if (nparc) totalParcelas = parseInt(nparc[1], 10);

    if (/\b(uma|1)\s+vez(es)?\b|\bà\s+vista\b|\bsem\s+dividir\b/i.test(t)) totalParcelas = 1;

    // "no mínimo 200 por mês" / "pagar 200 por mês" → 200 é o valor da parcela,
    // NÃO o total. O total precisa ser outro número na frase (ex: "Peguei 800").
    const minPorMes = t.match(/\b(?:no\s+m[íi]nimo|pelo\s+menos|parcela\s+de|de)\s+(\d+(?:[,\.]\d+)?)\s*(?:por\s+(?:m[êe]s|mes|semana|semanal|ano|anual)|\/\s*(?:m[êe]s|mes|semana|semanal|ano|anual))/i);
    if (minPorMes && totalParcelas === 1) {
      valorParcela = parseFloat(minPorMes[1].replace(',', '.'));
      // Pega TODOS os números razoáveis da frase
      const todosNumeros = [...t.matchAll(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)(?:[,\.]\d{2})?/g)]
        .map((m) => parseFloat(m[1].replace(/\./g, '').replace(',', '.')))
        .filter((n) => isFinite(n) && n > 0);
      // O valor total é o maior número (geralmente vem antes do "mínimo X por mês")
      // Ou o primeiro número, se houver só dois e o segundo é a parcela
      if (todosNumeros.length >= 2) {
        // Heurística: se um dos números é múltiplo do outro, o maior é o total
        const maior = Math.max(...todosNumeros);
        valorTotal = maior;
        valorParcela = todosNumeros.find((n) => n !== maior) ?? valorParcela;
        // Calcula total de parcelas pelo ratio
        const ratio = valorTotal / valorParcela;
        if (ratio >= 1 && ratio <= 48 && Math.abs(ratio - Math.round(ratio)) < 0.01) {
          totalParcelas = Math.round(ratio);
        } else {
          totalParcelas = Math.ceil(ratio);
        }
      }
    }

    // Recorrência
    let recorrencia: 'unica' | 'semanal' | 'mensal' | 'anual' = 'mensal';
    if (totalParcelas === 1) recorrencia = 'unica';
    else if (/semanal|por\s+semana/i.test(t)) recorrencia = 'semanal';
    else if (/anual|por\s+ano/i.test(t)) recorrencia = 'anual';

    // Descrição: tenta achar pessoa/coisa
    let descricao = '';
    const comMatch = t.match(/\bcom\s+(?:a|o)?\s*([A-ZÀ-Úa-zà-ú]+)/);
    const paraMatch = t.match(/\b(?:para|pra)\s+(?:pagar\s+)?(?:o|a|os|as)?\s*([A-ZÀ-Úa-zà-ú]+)/i);
    if (comMatch && paraMatch) {
      descricao = `${comMatch[1]} para ${paraMatch[1]}`;
    } else if (comMatch) {
      descricao = `empréstimo ${comMatch[1]}`;
    } else if (paraMatch) {
      descricao = paraMatch[1];
    } else {
      descricao = tipo === 'pagar' ? 'empréstimo recebido' : 'empréstimo dado';
    }

    // Data primeira parcela (token-based; webhook converte)
    let data_primeira: string | null = null;
    if (/\bamanh[ãa]\b/i.test(t)) data_primeira = 'AMANHA';
    else if (/\bhoje\b/i.test(t)) data_primeira = 'HOJE';
    else {
      const diaMatch = t.match(/\bdia\s+(\d{1,2})\b/i);
      if (diaMatch) data_primeira = `DIA_${parseInt(diaMatch[1], 10)}`;
    }

    return {
      intent: 'compromisso',
      confidence: 0.92,
      tipo,
      descricao: descricao.toLowerCase(),
      valor_total: valor,
      total_parcelas: totalParcelas,
      recorrencia,
      data_primeira,
    };
  }

  // === Lançamento: precisa de verbo financeiro explícito ===
  const temVerboGasto = /\b(gastei|gastar|paguei|pagar|comprei|comprar|sac[ou]ei|debit[ou]|custei|despesa|sa[ií]da)\b/i.test(t);
  const temVerboReceita = /\b(recebi|receber|ganhei|ganhar|entrou|caiu|depositou|sal[áa]rio|freelance|cliente|entrada)\b/i.test(t);

  if (!temVerboGasto && !temVerboReceita) return null;

  const tipo: 'gasto' | 'receita' = temVerboReceita && !temVerboGasto ? 'receita' : 'gasto';

  // Categoria
  let category: string | null = null;
  if (/\bposto|gasolina|combustível|abastec/i.test(t)) category = 'posto';
  else if (/\bmercado|supermercado|feira/i.test(t)) category = 'mercado';
  else if (/\buber|99|taxi|ônibus|onibus|metro|metrô/i.test(t)) category = 'transporte';
  else if (/\bifood|i?food|restaurante|lanche|almoço|almoco|jantar|delivery|comida|café|cafe|pizza|hamb[úu]rguer/i.test(t)) category = 'alimentacao';
  else if (/\baluguel|condom[ií]nio|luz|água|agua|internet|conta\s+de\s+luz/i.test(t)) category = 'moradia';
  else if (/\bfarm[áa]cia|rem[ée]dio|m[ée]dico|hospital|academia/i.test(t)) category = 'saude';
  else if (/\bcinema|netflix|spotify|show|festa|viagem|streaming|jogo/i.test(t)) category = 'lazer';
  else if (/\bcurso|livro|faculdade|escola|aula/i.test(t)) category = 'educacao';

  return {
    intent: 'lancamento',
    confidence: 0.9,
    type: tipo,
    amount: valor,
    category,
    description: null,
    payment_method: null,
    occurred_at: null,
  };
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
 * Parser principal: tenta regex local primeiro (rápido e determinístico).
 * Se não bater com confiança, chama o Groq.
 */
export async function parseMensagem(texto: string): Promise<ParsedIntent> {
  // 1. Tenta parser local (caminho rápido)
  const local = tentarParseLocal(texto);
  if (local && local.confidence >= 0.85) {
    console.log(`[parser] local hit (${local.intent}, conf=${local.confidence})`);
    return local;
  }

  // 2. Cai pro Groq
  const groq = getGroq();
  const { text } = await generateText({
    model: groq('llama-3.1-8b-instant'), // mais rápido e determinístico que gpt-oss-120b
    system: SYSTEM_PROMPT,
    prompt: texto,
    temperature: 0.05,
    maxTokens: 600,
  });

  // Extrai o JSON puro (modelo pode devolver lixo em volta)
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) {
    // Fallback pro local se Groq falhou
    if (local) return local;
    return { intent: 'outro', confidence: 0 };
  }
  try {
    const parsed = JSON.parse(match[0]) as ParsedIntent;
    return parsed;
  } catch {
    if (local) return local;
    return { intent: 'outro', confidence: 0 };
  }
}
