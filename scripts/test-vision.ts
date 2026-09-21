/**
 * Audit script: testa cada camada do pipeline de food photo isoladamente.
 * Rodar com: npx tsx scripts/test-vision.ts /tmp/foto.jpg
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { generateText } from 'ai';

async function main() {
  // ==== 1. Verificar env vars ====
  console.log('\n=== 1. ENV VARS ===');
  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  console.log('GOOGLE/GEMINI_API_KEY:', googleKey ? '✅ configurada' : '❌ NÃO CONFIGURADA');
  console.log('GROQ_API_KEY:', groqKey ? '✅ configurada' : '❌ NÃO CONFIGURADA');

  if (!googleKey) {
    console.warn('\n⚠️ Gemini key não configurada — pulando teste Gemini. Para testar, exporta GOOGLE_GENERATIVE_AI_API_KEY=... ou GEMINI_API_KEY=...');
  }

  // ==== 2. Ler imagem de teste ====
  console.log('\n=== 2. IMAGEM DE TESTE ===');
  const imgPath = process.argv[2] ?? '/tmp/test-food.jpg';
  let base64: string;
  try {
    const buffer = readFileSync(resolve(imgPath));
    base64 = buffer.toString('base64');
    console.log(`✅ Carregada: ${imgPath} (${buffer.byteLength} bytes, ${base64.length} chars base64)`);
  } catch (e: any) {
    console.error(`❌ Não consegui ler ${imgPath}: ${e.message}`);
    console.error('Baixa qualquer foto de comida, salva nesse path, e roda de novo.');
    process.exit(1);
  }

  // ==== 3. Testar Gemini ====
  if (!googleKey) {
    console.log('\n=== 3. GEMINI 2.5 FLASH LITE ===  ⏭️ PULADO (sem key)');
  } else {
  console.log('\n=== 3. GEMINI 2.5 FLASH LITE ===');
  const t0 = Date.now();
  try {
    const google = createGoogleGenerativeAI({ apiKey: googleKey });
    const { text } = await generateText({
      model: google('gemini-2.5-flash-lite'),
      system: 'Você é nutricionista. Responda em JSON puro.',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Analise esta foto de comida brasileira. Liste cada item separado em gramas e kcal.' },
          { type: 'image', image: `data:image/jpeg;base64,${base64}` },
        ],
      }],
      temperature: 0.1,
      maxTokens: 800,
    });
    console.log(`✅ Gemini respondeu em ${Date.now() - t0}ms`);
    console.log('Resposta (primeiros 800 chars):');
    console.log(text.slice(0, 800));

    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        console.log('\n✅ JSON parseado OK.');
        console.log('   itens:', parsed.itens?.length ?? 0);
        console.log('   kcal total:', parsed.totais?.kcal ?? '?');
      } catch {
        console.log('\n⚠️ JSON não parseou');
      }
    } else {
      console.log('\n❌ Nenhum JSON na resposta');
    }
  } catch (e: any) {
    console.error(`❌ Gemini falhou em ${Date.now() - t0}ms`);
    console.error('   message:', e.message);
    if (e.cause) console.error('   cause:', JSON.stringify(e.cause, null, 2));
    if (e.statusCode) console.error('   statusCode:', e.statusCode);
  }
  }

  // ==== 4. Testar Groq (fallback) ====
  if (groqKey) {
    console.log('\n=== 4. GROQ LLAMA 3.2 90B VISION (fallback) ===');
    const t1 = Date.now();
    try {
      const groq = createGroq({ apiKey: groqKey });
      const { text } = await generateText({
        model: groq('qwen/qwen3.8-27b'),
        system: 'Você é nutricionista. Responda em JSON puro.',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Analise esta foto de comida brasileira.' },
            { type: 'image', image: `data:image/jpeg;base64,${base64}` },
          ],
        }],
        temperature: 0.1,
        maxTokens: 800,
      });
      console.log(`✅ Groq respondeu em ${Date.now() - t1}ms`);
      console.log('Resposta (primeiros 500 chars):', text.slice(0, 500));
    } catch (e: any) {
      console.error(`❌ Groq falhou em ${Date.now() - t1}ms:`, e.message);
    }
  }

  // ==== 5. Testar imports do projeto ====
  console.log('\n=== 5. IMPORTS DO PROJETO ===');
  try {
    const { uploadFoodPhoto } = await import('../lib/food-photo-storage');
    console.log('✅ lib/food-photo-storage.ts OK');
  } catch (e: any) {
    console.error('❌ lib/food-photo-storage.ts falhou:', e.message);
  }

  try {
    const { analyzeFoodPhoto } = await import('../lib/food-summary');
    console.log('✅ lib/food-summary.ts OK');
  } catch (e: any) {
    console.error('❌ lib/food-summary.ts falhou:', e.message);
  }

  try {
    const { getResumoHoje } = await import('../lib/nutricao/resumo-dia');
    console.log('✅ lib/nutricao/resumo-dia.ts OK');
  } catch (e: any) {
    console.error('❌ lib/nutricao/resumo-dia.ts falhou:', e.message);
  }

  try {
    const { getMetasNutricao } = await import('../lib/nutricao/metas');
    console.log('✅ lib/nutricao/metas.ts OK');
  } catch (e: any) {
    console.error('❌ lib/nutricao/metas.ts falhou:', e.message);
  }

  console.log('\n=== FIM ===');
}

main().catch((e) => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
