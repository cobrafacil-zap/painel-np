/**
 * Redirect legado: /financeiro/reserva-emergencia → /financeiro/investimentos?tab=reserva
 *
 * Mantido por consistência com /financeiro/renda-passiva (também redirect).
 * A aba "reserva" é o default (sem query), mas ?tab=reserva é aceito pra
 * preservar deep links.
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ReservaEmergenciaLegacyPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/financeiro/investimentos?tab=reserva');
  }, [router]);
  return null;
}
