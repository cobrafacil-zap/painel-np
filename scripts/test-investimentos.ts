/**
 * Testes unitários das funções puras de investimentos.
 * Rodar com: npx tsx scripts/test-investimentos.ts
 *
 * Cobre:
 *   - somarInvestido: vazio, valores string/number
 *   - investidoPorMes: agrupamento por mês no fuso de São Paulo
 *   - totaisComInvestimento: receita E gasto sobem, saldo não muda
 */

import {
  somarInvestido,
  investidoPorMes,
  totaisComInvestimento,
} from '../lib/financeiro/investimentos';

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

// === somarInvestido ===
assertEq(somarInvestido([]), 0, 'somarInvestido vazio = 0');
assertEq(
  somarInvestido([
    { valor: 100, occurred_at: '2026-11-05T12:00:00Z' },
    { valor: '250.5', occurred_at: '2026-11-10T12:00:00Z' },
    { valor: 49.5, occurred_at: '2026-11-20T12:00:00Z' },
  ]),
  400,
  'somarInvestido soma number e string',
);

// === investidoPorMes ===
assertEq(
  JSON.stringify(investidoPorMes([])),
  JSON.stringify({}),
  'investidoPorMes vazio = {}',
);

const porMes = investidoPorMes([
  { valor: 100, occurred_at: '2026-11-05T12:00:00Z' },
  { valor: 200, occurred_at: '2026-11-20T12:00:00Z' },
  { valor: 50, occurred_at: '2026-12-01T12:00:00Z' },
]);
assertEq(porMes['2026-11'], 300, 'investidoPorMes agrupa no mesmo mês');
assertEq(porMes['2026-12'], 50, 'investidoPorMes separa meses diferentes');

// 2026-12-01T01:30Z = 30/11 22:30 em São Paulo → conta em novembro
const virada = investidoPorMes([
  { valor: 77, occurred_at: '2026-12-01T01:30:00Z' },
]);
assertEq(virada['2026-11'], 77, 'investidoPorMes usa fuso de São Paulo na virada do mês');
assertEq(virada['2026-12'], undefined, 'investidoPorMes não vaza pra dezembro');

// === totaisComInvestimento ===
const t = totaisComInvestimento(5000, 3000, 800);
assertEq(t.receitas, 5800, 'receitas sobem com o investimento');
assertEq(t.gastos, 3800, 'gastos sobem com o investimento');
assertEq(t.saldo, 2000, 'saldo não muda com o investimento');

const tZero = totaisComInvestimento(5000, 3000, 0);
assertEq(tZero.receitas, 5000, 'sem investimento receitas ficam iguais');
assertEq(tZero.gastos, 3000, 'sem investimento gastos ficam iguais');

console.log(`\n--- Resultado ---`);
console.log(`Passou: ${passed} | Falhou: ${failed}`);
if (failed > 0) process.exit(1);
