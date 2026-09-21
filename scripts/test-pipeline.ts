/**
 * Testa analyzeFoodPhoto end-to-end com imagem real.
 * Rodar: npx tsx scripts/test-pipeline.ts /tmp/foto.jpg
 */
import { readFileSync } from 'fs';
import { analyzeFoodPhoto } from '../lib/food-summary';

async function main() {
  const imgPath = process.argv[2] ?? '/tmp/test-food-real.jpg';
  const buf = readFileSync(imgPath);
  const b64 = buf.toString('base64');
  console.log(`Foto: ${imgPath} (${buf.byteLength} bytes)`);

  console.log('\n--- analyzeFoodPhoto ---');
  const result = await analyzeFoodPhoto({
    base64: b64,
    mimeType: 'image/jpeg',
    horaAtualBRT: { hora: 12 },
  });

  if (!result) {
    console.log('❌ analyzeFoodPhoto retornou null');
    process.exit(1);
  }

  console.log('✅ Retornou:');
  console.log(`   kcal: ${result.kcal}`);
  console.log(`   protein_g: ${result.protein_g}`);
  console.log(`   carb_g: ${result.carb_g}`);
  console.log(`   fat_g: ${result.fat_g}`);
  console.log(`   meal_type: ${result.meal_type}`);
  console.log(`   confidence: ${result.confidence}`);
  console.log(`   itens (${result.itens.length}):`);
  result.itens.forEach((it, i) => {
    console.log(`     ${i + 1}. ${it.nome} | ${it.gramas}g | ${it.kcal}kcal | P:${it.prot} C:${it.carb} G:${it.gord}`);
  });
}

main().catch((e) => {
  console.error('Erro:', e.message);
  process.exit(1);
});
