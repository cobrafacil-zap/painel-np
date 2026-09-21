/**
 * Redirect legado: /financeiro/renda-passiva → /financeiro/investimentos?tab=renda-passiva
 *
 * A feature foi unificada em /financeiro/investimentos com 2 abas.
 * Mantemos esse arquivo pra preservar bookmarks e links antigos.
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RendaPassivaLegacyPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/financeiro/investimentos?tab=renda-passiva');
  }, [router]);
  return null;
}
