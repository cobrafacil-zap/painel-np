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

RECEBA uma frase em português brasileiro e EXTRAIA o que ela representa:
- Um lançamento (gasto ou receita) a ser registrado.
- Uma consulta sobre os dados já registrados.
- Outra coisa (cumprimento, dúvida, etc.).

CATEGORIAS CONHECIDAS (use o slug quando souber; senão devolva null):
- mercado (compras de supermercado)
- transporte (uber, gasolina, ônibus, metrô)
- alimentacao (restaurante, lanche, delivery, ifood)
- moradia (aluguel, condomínio, luz, água, internet)
- saude (farmácia, médico, academia)
- lazer (cinema, viagem, festa, streaming)
- educacao (curso, livro, material)
- assinaturas (netflix, spotify, mensalidades)
- freelance (trabalho avulso)
- salario (salário fixo, pagamento mensal)
- investimentos (renda fixa, ações, cripto)
- posto (gasolina, troca de óleo, lava jato)
- cartao_credito (fatura cartão de crédito)
- outros (se não encaixar)

FORMAS DE PAGAMENTO (devolva o slug):
pix | cartao_credito | cartao_debito | dinheiro | boleto | transferencia

INTENÇÕES:
- "lancamento": registro simples (gasto/receita). Ex: "gastei 50 no mercado".
- "compromisso": dívida/empréstimo/conta futura. Ex: "peguei 800 com minha mãe, pagar 200/mês".
- "consulta": pergunta sobre dados. Ex: "quanto gastei?", "o que tenho pra pagar?".
- "acao": comando destrutivo. Ex: "apagar último", "pagar parcela 2".
- "outro": cumprimentos, dúvidas genéricas.

SAÍDA (JSON estrito):
{
  "intent": "lancamento" | "compromisso" | "consulta" | "acao" | "outro",
  "confidence": number 0..1,
  // lancamento:
  "type": "gasto" | "receita",
  "amount": number,
  "category": string | null,
  "description": string | null,
  "payment_method": string | null,
  "occurred_at": string | null,
  // compromisso:
  "tipo": "pagar" | "receber",
  "descricao": string,
  "valor_total": number,
  "total_parcelas": number,
  "recorrencia": "unica" | "semanal" | "mensal" | "anual",
  "data_primeira": string | null,
  // consulta:
  "tipo": "gastos" | "receitas" | "saldo" | "top_categoria" | "compromissos" | "parcelas",
  "periodo": "hoje" | "semana" | "mes" | "mes_passado" | "tudo",
  "categoria": string | null,
  // acao:
  "acao": "apagar_ultimo" | "apagar_categoria" | "pagar_parcela",
  "alvo": string | null
}

EXEMPLOS:

"gastei 50 no mercado hoje" →
{"intent":"lancamento","confidence":0.97,"type":"gasto","amount":50,"category":"mercado","description":"mercado","payment_method":null,"occurred_at":null}

"recebi 1500 de freelance" →
{"intent":"lancamento","confidence":0.96,"type":"receita","amount":1500,"category":"freelance","description":"freelance","payment_method":null,"occurred_at":null}

"almoço 35 reais no ifood, pix" →
{"intent":"lancamento","confidence":0.93,"type":"gasto","amount":35,"category":"alimentacao","description":"almoço no ifood","payment_method":"pix","occurred_at":null}

"paguei 1200 de aluguel dia 5" →
{"intent":"lancamento","confidence":0.95,"type":"gasto","amount":1200,"category":"moradia","description":"aluguel","payment_method":null,"occurred_at":null}

"salário de 7500 caiu hoje" →
{"intent":"lancamento","confidence":0.94,"type":"receita","amount":7500,"category":"salario","description":"salário","payment_method":null,"occurred_at":null}

"Gastei 13 no posto de gasolina" →
{"intent":"lancamento","confidence":0.95,"type":"gasto","amount":13,"category":"posto","description":"posto de gasolina","payment_method":null,"occurred_at":null}

"gastei 12 de agua e chocolate no posto" →
{"intent":"lancamento","confidence":0.93,"type":"gasto","amount":12,"category":"posto","description":"agua e chocolate no posto","payment_method":null,"occurred_at":null}

"coloquei 50 de gasolina" →
{"intent":"lancamento","confidence":0.95,"type":"gasto","amount":50,"category":"posto","description":"gasolina","payment_method":null,"occurred_at":null}

"quanto gastei esse mês?" →
{"intent":"consulta","confidence":0.99,"tipo":"gastos","periodo":"mes","categoria":null}

"qual meu saldo?" →
{"intent":"consulta","confidence":0.99,"tipo":"saldo","periodo":"tudo","categoria":null}

"top categoria de gasto do mês" →
{"intent":"consulta","confidence":0.95,"tipo":"top_categoria","periodo":"mes","categoria":null}

"apagar último" →
{"intent":"acao","confidence":0.95,"acao":"apagar_ultimo","alvo":null}

"apaga o ultimo gasto" →
{"intent":"acao","confidence":0.95,"acao":"apagar_ultimo","alvo":null}

"remover o gasto do posto" →
{"intent":"acao","confidence":0.92,"acao":"apagar_categoria","alvo":"posto"}

"apagar tudo do mercado" →
{"intent":"acao","confidence":0.93,"acao":"apagar_categoria","alvo":"mercado"}

"peguei 800 com minha mae, pagar 200 por mes" →
{"intent":"compromisso","confidence":0.96,"tipo":"pagar","descricao":"empréstimo da mãe","valor_total":800,"total_parcelas":4,"recorrencia":"mensal","data_primeira":null}

"emprestei 500 pro joao em 2x" →
{"intent":"compromisso","confidence":0.95,"tipo":"receber","descricao":"empréstimo para joão","valor_total":500,"total_parcelas":2,"recorrencia":"mensal","data_primeira":null}

"recebi 300 emprestado do pai" →
{"intent":"compromisso","confidence":0.94,"tipo":"pagar","descricao":"empréstimo do pai","valor_total":300,"total_parcelas":1,"recorrencia":"unica","data_primeira":null}

"fatura do cartao 1500 vence dia 20" →
{"intent":"compromisso","confidence":0.94,"tipo":"pagar","descricao":"fatura do cartão","valor_total":1500,"total_parcelas":1,"recorrencia":"unica","data_primeira":null}

"o que tenho pra pagar?" →
{"intent":"consulta","confidence":0.97,"tipo":"compromissos","periodo":"tudo","categoria":null}

"quais minhas parcelas esse mes?" →
{"intent":"consulta","confidence":0.95,"tipo":"parcelas","periodo":"mes","categoria":null}

"paguei a parcela 2 do emprestimo da mae" →
{"intent":"acao","confidence":0.94,"acao":"pagar_parcela","alvo":"empréstimo da mãe:2"}

"oi" →
{"intent":"outro","confidence":0.98}

REGRAS:
- amount SEMPRE positivo (a definição de gasto/receita está em "type").
- Se a frase tiver vários valores (ex: "gastei 50 e recebi 100"), registre o primeiro lançamento só.
- "posto" cobre QUALQUER gasto em posto de gasolina: gasolina, álcool, troca de óleo, lava-jato, lanche no posto. SEMPRE use essa categoria se a frase mencionar "posto", "gasolina", "combustível", "abasteci".
- "gastei", "paguei", "comprei", "dei", "saquei" → tipo "gasto".
- "recebi", "ganhei", "entrou", "caiu", "depositou" → tipo "receita".
- Se encontrar verbo financeiro (gastei/paguei/recebi/ganhei/comprei) E um valor numérico na frase, é SEMPRE "lancamento", nunca "outro".
- "apagar", "remover", "deletar", "tirar", "excluir" + ("último" | "ultimo") → acao="apagar_ultimo".
- "apagar"/"remover"/"deletar" + nome de categoria (mercado, posto, uber…) → acao="apagar_categoria", alvo=<slug>.
- "peguei"/"tirei"/"recebi" + ("emprestado"|"emprestimo") → tipo="pagar" (eu devo devolver).
- "emprestei"/"dei emprestado" → tipo="receber" (me devem).
- "faturei"/"comprei parcelado" + valor → tipo="pagar".
- "recebi de volta"/"me pagaram" → registra pagamento de parcela (intent="acao").
- "em Nx", "N vezes", "N parcelas" → total_parcelas=N. Senão, 1.
- "por mês" → recorrencia="mensal". "por semana" → "semanal". Sem dica → "mensal".
- "o que tenho pra pagar", "minhas parcelas", "contas a pagar" → tipo="compromissos" ou "parcelas" no intent="consulta".
- "paguei a parcela N de X" → acao="pagar_parcela", alvo="<descrição>:N".
- "occurred_at" só preencha se o usuário disser explicitamente uma data ("ontem", "dia 5"). Para "hoje", devolva null (o sistema aplica hoje).
- Não invente categoria se não tiver certeza — devolva null.
- Não escreva markdown, comentários, nem nada fora do JSON.`;

let _groq: ReturnType<typeof createGroq> | null = null;
function getGroq() {
  if (_groq) return _groq;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY não configurada');
  _groq = createGroq({ apiKey });
  return _groq;
}

export async function parseMensagem(texto: string): Promise<ParsedIntent> {
  const groq = getGroq();
  const { text } = await generateText({
    model: groq('openai/gpt-oss-120b'),
    system: SYSTEM_PROMPT,
    prompt: texto,
    temperature: 0.1,
    maxTokens: 400,
  });

  // Tentar extrair o JSON puro (caso o modelo responda com lixo em volta)
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return { intent: 'outro', confidence: 0 };
  }
  try {
    const parsed = JSON.parse(match[0]) as ParsedIntent;
    return parsed;
  } catch {
    return { intent: 'outro', confidence: 0 };
  }
}
