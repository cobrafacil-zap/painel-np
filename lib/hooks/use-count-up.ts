'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './use-reduced-motion';

/**
 * Anima um número de 0 (ou `from`) até `value` em `duration` ms, com
 * easing easeOutCubic. Respeita `prefers-reduced-motion`.
 *
 * @example
 *   const display = useCountUp(saldo);
 *   <span>{formatBRL(display)}</span>
 */
export function useCountUp(value: number, options?: { duration?: number; from?: number }) {
  const { duration = 700, from = 0 } = options ?? {};
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(reduced ? value : from);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(from);
  const toRef = useRef(value);

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      return;
    }
    fromRef.current = display;
    toRef.current = value;
    startRef.current = null;

    const tick = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const next = fromRef.current + (toRef.current - fromRef.current) * eased;
      setDisplay(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration, reduced]);

  return display;
}
