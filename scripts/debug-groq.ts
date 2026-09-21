import { generateText } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { readFileSync } from 'fs';

async function main() {
  const groq = createGroq({ apiKey: process.env.GROQ_API_KEY! });
  const buf = readFileSync('/tmp/test-food-real.jpg');
  const b64 = buf.toString('base64');
  const r = await generateText({
    model: groq('qwen/qwen3.8-27b'),
    system: 'Você é nutricionista. Responda em JSON puro.',
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'Analise esta foto. Liste cada item separado em gramas e kcal.' },
      { type: 'image', image: 'data:image/jpeg;base64,' + b64 }
    ]}],
    temperature: 0.1, maxTokens: 800,
  });
  console.log('--- RESPOSTA COMPLETA ---');
  console.log(r.text);
  console.log('--- FIM ---');
  console.log('Length:', r.text.length);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
