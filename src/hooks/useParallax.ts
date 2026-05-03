import { useEffect, useRef } from 'react';

/**
 * Light vertical parallax driven by scroll position. Element transforms
 * up to ±maxOffset px based on its viewport position (top→bottom).
 */
export function useParallax<T extends HTMLElement>(maxOffset = 80) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    let raf = 0;

    const update = () => {
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const center = rect.top + rect.height / 2;
      const progress = (center - vh / 2) / vh; // -1..+1 typical
      const offset = -progress * maxOffset;
      el.style.transform = `translate3d(0, ${offset.toFixed(2)}px, 0) scale(1.08)`;
    };

    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [maxOffset]);

  return ref;
}
