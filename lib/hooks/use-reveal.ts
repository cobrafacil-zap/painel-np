'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Usa IntersectionObserver pra retornar true quando o elemento aparece
 * no viewport. Aplica classe `is-visible` em elementos `.reveal`.
 *
 * @example
 *   const ref = useReveal();
 *   <div ref={ref} className="reveal">...</div>
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(
  options?: IntersectionObserverInit
) {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            el.classList.add('is-visible');
            io.unobserve(el);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px', ...options }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [options]);

  return { ref, visible } as const;
}
