/**
 * Página /financeiro/investimentos — Reserva de Emergência + Renda Passiva.
 *
 * Sub-rota do financeiro com 2 abas (controladas via `?tab=`).
 * Server component leve que delega ao client `InvestimentosTabsSuspense`
 * (Suspense boundary pra satisfazer Next 15 useSearchParams/use).
 */

import { InvestimentosTabsSuspense } from './_components/investimentos-tabs';
import { PageHeader } from '../../_components/page-header';

export const metadata = {
  title: 'Investimentos · Painel NP',
};

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Módulo"
        title="Investimentos"
        subtitle="Reserva de emergência + planejamento de renda passiva. Tudo num lugar só."
      />
      <InvestimentosTabsSuspense searchParams={searchParams} />
    </div>
  );
}
