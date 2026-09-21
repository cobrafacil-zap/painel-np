/**
 * Testes unitários das funções puras de reserva-emergência.
 * Rodar com: npx tsx scripts/test-reserva-emergencia.ts
 *
 * Cobre:
 *   - calcularGastosFixosMensal: parcelado mensal/semanal/anual, pago ignorado, vazio
 *   - calcularMetaReserva: gastos × 6
 *   - calcularProgresso: gastos=0 (div-by-zero), completa, falta, meses_estimados
 */

import {
  calcularGastosFixosMensal,
  calcularMetaReserva,
  calcularProgresso,
  MULTIPLICADOR_MESES,
} from '../lib/financeiro/reserva-emergencia';

let passed = 0;
let failed = 0;

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual === expected) {
    console.log(`✅ ${label}`);
    passed++;
  } else {
    console.log(
      `❌ ${label}\n   esperado: ${JSON.stringify(expected)}\n   obtido:   ${JSON.stringify(actual)}`,
    );
    failed++;
  }
}

function assertClose(actual: number, expected: number, eps: number, label: string) {
  if (Math.abs(actual - expected) <= eps) {
    console.log(`✅ ${label}`);
    passed++;
  } else {
    console.log(
      `❌ ${label}\n   esperado: ${expected}\n   obtido:   ${actual} (diff ${Math.abs(actual - expected)})`,
    );
    failed++;
  }
}

console.log('--- calcularGastosFixosMensal ---');

// Compromisso único sem parcelas → soma valor integral
assertEq(
  calcularGastosFixosMensal([
    { valor_total: 1600, total_parcelas: 1, recorrencia: 'mensal', pago: false },
  ]),
  1600,
  'avulso único = valor_total integral',
);

// Parcelado mensal (4x de 400) → 1600/4 = 400
assertEq(
  calcularGastosFixosMensal([
    { valor_total: 1600, total_parcelas: 4, recorrencia: 'mensal', pago: false },
  ]),
  400,
  'parcelado mensal = valor_total / parcelas',
);

// Parcelado semanal (12x de 100) → 100*4 = 400
assertEq(
  calcularGastosFixosMensal([
    { valor_total: 1200, total_parcelas: 12, recorrencia: 'semanal', pago: false },
  ]),
  400,
  'parcelado semanal = valor_total/parcelas × 4',
);

// Anual com total_parcelas > 1 (ex: seguro de carro 1200 em 1x anual) → valorTotal/12 = 100
// (comportamento: anual sempre divide por 12 quando tem parcelas, igual renda-passiva)
assertEq(
  calcularGastosFixosMensal([
    { valor_total: 1200, total_parcelas: 2, recorrencia: 'anual', pago: false },
  ]),
  100,
  'anual parcelado = valor_total / 12',
);

// Pago = true → ignorado
assertEq(
  calcularGastosFixosMensal([
    { valor_total: 1600, total_parcelas: 1, recorrencia: 'mensal', pago: true },
    { valor_total: 500, total_parcelas: 1, recorrencia: 'mensal', pago: false },
  ]),
  500,
  'pago=true é ignorado',
);

// Lista vazia → 0
assertEq(calcularGastosFixosMensal([]), 0, 'lista vazia = 0');

// Multiplos combinados
// - 1600 avulso mensal → 1600 (cai no if totalParc<=1, soma integral)
// - 1200 parcelado mensal 4x → 300 (caí no else if mensal)
// - 800 parcelado semanal 4x → 800 (caí no else if semanal: 800/4*4 = 800)
assertEq(
  calcularGastosFixosMensal([
    { valor_total: 1600, total_parcelas: 1, recorrencia: 'mensal', pago: false }, // 1600
    { valor_total: 1200, total_parcelas: 4, recorrencia: 'mensal', pago: false }, // 300
    { valor_total: 800, total_parcelas: 4, recorrencia: 'semanal', pago: false }, // 800
  ]),
  2700,
  'mix de compromisso avulso + parcelado + semanal',
);

// total_parcelas null → tratado como 1 (avulso)
assertEq(
  calcularGastosFixosMensal([
    { valor_total: 500, total_parcelas: null, recorrencia: 'mensal', pago: false },
  ] as any),
  500,
  'total_parcelas=null tratado como 1',
);

console.log('\n--- calcularMetaReserva ---');

assertEq(MULTIPLICADOR_MESES, 6, 'MULTIPLICADOR_MESES = 6');

assertClose(calcularMetaReserva(1600), 9600, 0.01, 'meta = 1600 × 6 = 9600');

assertClose(calcularMetaReserva(0), 0, 0.01, 'meta = 0 quando gastos=0');

assertClose(calcularMetaReserva(1234.56), 7407.36, 0.01, 'meta com arredondamento 2 casas');

assertClose(calcularMetaReserva(3500), 21000, 0.01, 'meta = 3500 × 6 = 21000');

console.log('\n--- calcularProgresso ---');

// Caso base: gastos 0 → meta 0 → progresso 0 (sem div-by-zero)
const p0 = calcularProgresso(0, 0);
assertEq(p0.meta, 0, 'progresso.meta = 0 quando gastos=0');
assertEq(p0.progresso_pct, 0, 'progresso.progresso_pct = 0 quando meta=0');
assertEq(p0.completa, false, 'progresso.completa = false quando meta=0');
assertEq(p0.falta, 0, 'progresso.falta = 0 quando meta=0');

// Estado inicial: nada depositado
const pIni = calcularProgresso(1600, 0);
assertClose(pIni.meta, 9600, 0.01, 'progresso.meta inicial');
assertEq(pIni.total_depositado, 0, 'progresso.total_depositado = 0');
assertClose(pIni.progresso_pct, 0, 0.001, 'progresso_pct = 0 inicialmente');
assertEq(pIni.completa, false, 'completta = false inicialmente');
assertClose(pIni.falta, 9600, 0.01, 'falta = meta total');
assertEq(pIni.meses_estimados, null, 'meses_estimados = null quando aporte=0');

// Parcial: 50% (4800 de 9600)
const p50 = calcularProgresso(1600, 4800);
assertClose(p50.progresso_pct, 0.5, 0.001, 'progresso_pct = 0.5 quando 50%');
assertEq(p50.completa, false, '50% não está completa');
assertClose(p50.falta, 4800, 0.01, 'falta = 4800');
assertEq(p50.meses_estimados, null, 'meses_estimados = null quando aporte=0');

// Exatamente na meta: 9600 = 9600
const p100 = calcularProgresso(1600, 9600);
assertEq(p100.completa, true, '100% está completa');
assertEq(p100.falta, 0, 'falta = 0 quando na meta');
assertClose(p100.progresso_pct, 1.0, 0.001, 'progresso_pct = 1.0 na meta');

// Passou da meta
const pOver = calcularProgresso(1600, 12000);
assertEq(pOver.completa, true, 'acima da meta = completa');
assertEq(pOver.falta, 0, 'falta = 0 quando acima da meta');
assertClose(pOver.progresso_pct, 1.25, 0.001, 'progresso_pct > 1 quando passa da meta');

// Com aporte mensal: meses_estimados
const pAporte = calcularProgresso(1600, 0, 1000);
// falta 9600, aporte 1000 → 10 meses (ceil(9.6) = 10)
assertEq(pAporte.meses_estimados, 10, 'meses_estimados = ceil(9600/1000) = 10');

const pAporte2 = calcularProgresso(1600, 4800, 1000);
// falta 4800, aporte 1000 → 5 meses
assertEq(pAporte2.meses_estimados, 5, 'meses_estimados = ceil(4800/1000) = 5');

// aporte maior que falta → 1 mês
const pAporte3 = calcularProgresso(1600, 9500, 1000);
// falta 100, aporte 1000 → 1 mês (ceil(0.1) = 1)
assertEq(pAporte3.meses_estimados, 1, 'meses_estimados = 1 quando aporte cobre tudo');

const pAporte4 = calcularProgresso(1600, 9600, 1000);
// falta 0 → null (não precisa de meses)
assertEq(pAporte4.meses_estimados, null, 'meses_estimados = null quando já completa');

// Aporte 0 → null
const pAporteZero = calcularProgresso(1600, 0, 0);
assertEq(pAporteZero.meses_estimados, null, 'meses_estimados = null quando aporte=0');

// Arredondamento de total_depositado
const pRound = calcularProgresso(1600, 1234.567);
assertEq(pRound.total_depositado, 1234.57, 'total_depositado arredondado 2 casas');

console.log(`\n--- Resultado ---`);
console.log(`Passou: ${passed} | Falhou: ${failed}`);
if (failed > 0) process.exit(1);
