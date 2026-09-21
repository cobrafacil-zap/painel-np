/**
 * Testa o modo detalhado (nutricionista).
 * npx tsx scripts/test-detailed.ts /tmp/foto.jpg
 */
import { readFileSync } from 'fs';
import { analyzeFoodPhotoDetailed, analyzeFoodPhoto, pedidoAnaliseDetalhada } from '../lib/food-summary';

async function main() {
  const imgPath = process.argv[2] ?? '/tmp/test-food-real.jpg';
  const buf = readFileSync(imgPath);
  const b64 = buf.toString('base64');

  console.log('--- TEST pedidoAnaliseDetalhada ---');
  console.log('"nutricionista" →', pedidoAnaliseDetalhada('nutricionista'));
  console.log('"faz a análise" →', pedidoAnaliseDetalhada('faz a análise completa'));
  console.log('"oi" →', pedidoAnaliseDetalhada('oi'));

  console.log('\n--- analyzeFoodPhotoDetailed ---');
  const t0 = Date.now();
  const detalhada = await analyzeFoodPhotoDetailed({
    base64: b64,
    mimeType: 'image/jpeg',
    horaAtualBRT: { hora: 12 },
  });
  console.log(`(${Date.now() - t0}ms)`);
  if (!detalhada) {
    console.log('❌ Retornou null');
    process.exit(1);
  }
  console.log('model:', detalhada.model);
  console.log('\n=== TEXTO ===');
  console.log(detalhada.text);
  console.log('=== FIM ===');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
