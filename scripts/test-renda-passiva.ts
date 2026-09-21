/**
 * Testes unitários das funções puras de renda-passiva.
 * Rodar com: npx tsx scripts/test-renda-passiva.ts
 *
 * Cobre:
 *   - capital_necessario com exemplo do user (700/0.001 = 700.000)
 *   - meses_ate_capital pra cada cenário
 *   - projetarValorAcumulado (FV de série)
 *   - formatarPrazo
 *   - simularRendaPassiva ponta a ponta
 *   - Edge cases: aporte zero, taxa zero, valores negativos
 */

import {
  calcularCapitalNecessario,
  calcularMesesAteCapital,
  projetarValorAcumulado,
  simularRendaPassiva,
  formatarPrazo,
  CENARIOS,
} from '../lib/financeiro/renda-passiva';

let passed = 0;
let failed = 0;

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual === expected) {
    console.log(`✅ ${label}`);
    passed++;
  } else {
    console.log(`❌ ${label}\n   esperado: ${JSON.stringify(expected)}\n   obtido:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertClose(actual: number, expected: number, eps: number, label: string) {
  if (Math.abs(actual - expected) <= eps) {
    console.log(`✅ ${label}`);
    passed++;
  } else {
    console.log(`❌ ${label}\n   esperado: ~${expected} (±${eps})\n   obtido:   ${actual}`);
    failed++;
  }
}

function assertNull(actual: any, label: string) {
  if (actual === null) {
    console.log(`✅ ${label}`);
    passed++;
  } else {
    console.log(`❌ ${label} (esperava null, veio ${actual})`);
    failed++;
  }
}

console.log('\n=== CENÁRIOS ===');
assertEq(CENARIOS.length, 4, '4 cenários cadastrados');
assertEq(CENARIOS[0].id, 'conservador', 'primeiro cenário = conservador');
assertEq(CENARIOS[0].taxa_mensal, 0.005, 'conservador 0,5% a.m.');
assertEq(CENARIOS[3].id, 'cripto', 'último cenário = cripto');
assertEq(CENARIOS[3].taxa_mensal, 0.03, 'cripto 3% a.m.');

console.log('\n=== calcularCapitalNecessario ===');
// Exemplo do user: 700/mês ÷ 0.001 = R$ 700.000
assertClose(
  calcularCapitalNecessario(700, 0.001),
  700000,
  0.5,
  '700/mês ÷ 0.1% a.m. = R$ 700.000 (exemplo do user)',
);
// 5000/mês ÷ 1% a.m. = R$ 500.000
assertClose(
  calcularCapitalNecessario(5000, 0.01),
  500000,
  0.5,
  '5000/mês ÷ 1% a.m. = R$ 500.000',
);
// Conservador: 5000 ÷ 0.005 = R$ 1.000.000
assertClose(
  calcularCapitalNecessario(5000, 0.005),
  1000000,
  0.5,
  '5000/mês ÷ 0.5% a.m. = R$ 1.000.000 (conservador)',
);
// Edge: renda ou taxa 0
assertEq(calcularCapitalNecessario(0, 0.01), 0, 'renda 0 → capital 0');
assertEq(calcularCapitalNecessario(1000, 0), 0, 'taxa 0 → capital 0');
assertEq(calcularCapitalNecessario(-100, 0.01), 0, 'renda negativa → capital 0');

console.log('\n=== calcularMesesAteCapital ===');
// 5000/mês de aporte, 1% a.m., alvo R$ 100.000
// FV = 5000 × ((1.01^n - 1) / 0.01) = 100.000
// (1.01^n - 1) = 0.2 → 1.01^n = 1.2 → n = log(1.2)/log(1.01) ≈ 18.2 → ceil 19
const meses_5000_1pct_100k = calcularMesesAteCapital(100000, 5000, 0.01);
assertClose(meses_5000_1pct_100k ?? 0, 19, 0.5, '5000/mês, 1%, R$ 100k ≈ 19 meses (1,6 anos)');

// Aporte zero sem capital inicial → nunca
assertNull(calcularMesesAteCapital(100000, 0, 0.01), 'aporte zero → null');

// Capital já atingido → 0 meses
assertEq(
  calcularMesesAteCapital(0, 1000, 0.01),
  0,
  'capital alvo 0 → 0 meses',
);

// Sem taxa (linear): 100k com 1k/mês = 100 meses
assertEq(
  calcularMesesAteCapital(100000, 1000, 0),
  100,
  'sem taxa: 100k ÷ 1k/mês = 100 meses',
);

console.log('\n=== projetarValorAcumulado ===');
// Sem capital inicial, 1000/mês, 1% a.m., 12 meses
// FV = 1000 × ((1.01^12 - 1) / 0.01) ≈ 12.682,5
const proj1 = projetarValorAcumulado(1000, 0.01, 12);
assertClose(proj1.valorFinal, 12682.5, 5, '1000/mês × 12 meses a 1% ≈ R$ 12.682,50');
assertEq(proj1.totalAportado, 12000, 'total aportado = 12.000');
assertClose(proj1.jurosGanhos, 682.5, 5, 'juros ganhos ≈ R$ 682,50');

// Com capital inicial: 10k inicial + 500/mês × 24 meses a 0,5%
// FV_capital = 10.000 × 1.005^24 ≈ 11.271,79
// FV_serie = 500 × ((1.005^24 - 1) / 0.005)
//          = 500 × (0.12716 / 0.005) = 500 × 25.43 ≈ 12.715,80
// Total ≈ 23.987,59
const proj2 = projetarValorAcumulado(500, 0.005, 24, 10000);
assertClose(proj2.valorFinal, 23987.59, 1, '10k + 500/mês × 24m a 0,5% ≈ R$ 23.987,59');

// Sem tempo: retorna capital inicial
const proj3 = projetarValorAcumulado(1000, 0.01, 0, 5000);
assertEq(proj3.valorFinal, 5000, 'meses=0 → só capital inicial');
assertEq(proj3.totalAportado, 0, 'meses=0 → total aportado 0');

console.log('\n=== formatarPrazo ===');
assertEq(formatarPrazo(12), '1 ano', '12 meses → "1 ano"');
assertEq(formatarPrazo(24), '2 anos', '24 meses → "2 anos"');
assertEq(formatarPrazo(30), '2 anos e 6 meses', '30 meses → "2 anos e 6 meses"');
assertEq(formatarPrazo(1), '1 mês', '1 mês → "1 mês"');
assertEq(formatarPrazo(11), '11 meses', '11 meses');
assertEq(formatarPrazo(0), 'hoje', '0 meses → "hoje"');
assertEq(formatarPrazo(null), '— (aporte zerado)', 'null → "— (aporte zerado)"');

console.log('\n=== simularRendaPassiva (integração) ===');
const linhas = simularRendaPassiva({ rendaMensalDesejada: 3000, aporteMensal: 700 });
assertEq(linhas.length, 4, '4 linhas de cenário');

// Conservador: 3000/0.005 = R$ 600.000 capital HOJE
assertClose(linhas[0].capital_necessario, 600000, 0.5, 'conservador R$ 600k');

// Moderado: 3000/0.01 = R$ 300.000
assertClose(linhas[1].capital_necessario, 300000, 0.5, 'moderado R$ 300k');

// Cenário user: renda 7000, aporte 700, cenário conservador (0.005)
// capital alvo = 7000 / 0.005 = 1.400.000
// tempo com 700/mês a 0,5%... juros muito baixos → bastante tempo
const linhasUser = simularRendaPassiva({ rendaMensalDesejada: 7000, aporteMensal: 700 });
assertClose(linhasUser[0].capital_necessario, 1400000, 0.5, 'user: conservador R$ 1.4M');
assertClose(linhasUser[1].capital_necessario, 700000, 0.5, 'user: moderado R$ 700k');

console.log('\n=== Edge cases integração ===');
// aporte 0 → todas linhas com meses_ate_atingir=null
const linhasZero = simularRendaPassiva({ rendaMensalDesejada: 5000, aporteMensal: 0 });
for (const l of linhasZero) {
  if (l.meses_ate_atingir !== null) {
    console.log(`❌ aporte 0 deveria dar meses=null mas ${l.cenario.id} = ${l.meses_ate_atingir}`);
    failed++;
  }
}
passed++; // (counter manual)

// renda 0 → todas com capital 0
const linhasVazias = simularRendaPassiva({ rendaMensalDesejada: 0, aporteMensal: 1000 });
for (const l of linhasVazias) {
  if (l.capital_necessario !== 0) {
    console.log(`❌ renda 0 deveria dar capital=0 mas ${l.cenario.id} = ${l.capital_necessario}`);
    failed++;
  } else {
    passed++;
  }
}

console.log(`\n=== RESUMO ===`);
console.log(`passou: ${passed}`);
console.log(`falhou: ${failed}`);

if (failed > 0) process.exit(1);
process.exit(0);
