'use client';

/**
 * Aba "Renda Passiva" (#feature renda-passiva).
 *
 * Wrapper fino em torno do componente existente
 * `renda-passiva-card.tsx`, com a prop `mostrarVoltar={false}` pra
 * evitar o botão "← voltar" que mandava o user pra /financeiro.
 *
 * Renderiza ambas as abas simultaneamente (a pai InvestmentsTabs
 * esconde via className "hidden"), preservando o state local do
 * componente (useState, useRef, localStorage).
 */

import RendaPassivaPage from '@/app/(app)/financeiro/_components/renda-passiva-card';

export function AbaRendaPassiva() {
  return <RendaPassivaPage mostrarVoltar={false} />;
}
