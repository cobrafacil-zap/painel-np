'use client';

import { useEffect, useState } from 'react';

/**
 * Detecta `prefers-reduced-motion: reduce` e atualiza se o usuário mudar
 * a preferência. Retorna `true` se reduced-motion estiver ativo.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return reduced;
}
