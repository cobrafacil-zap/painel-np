/**
 * Página /financeiro/investimentos — investimentos por categoria:
 * Reserva · Imobiliário · Ações. Sem projeção/cenário.
 */

import { InvestimentosView } from './_components/investimentos-view';
import { PageHeader } from '../../_components/page-header';

export const metadata = {
  title: 'Investimentos · Painel NP',
};

export default function Page() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Módulo"
        title="Investimentos"
        subtitle="Seus investimentos por categoria: reserva, imobiliário e ações."
      />
      <InvestimentosView />
    </div>
  );
}
