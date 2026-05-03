import { useEffect, useRef } from 'react';

/**
 * Subtle magnetic effect: the element follows the cursor by `strength`%
 * of the offset from its center. Used on primary CTAs and the floating
 * call button. Respects prefers-reduced-motion.
 */
export function useMagnetic<T extends HTMLElement>(strength = 0.25, range = 80) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    if (window.matchMedia('(hover: none)').matches) return; // skip on touch

    let raf = 0;

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);

      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (dist < range) {
          el.style.transform = `translate(${dx * strength}px, ${dy * strength}px)`;
        } else {
          el.style.transform = '';
        }
      });
    };

    const onLeave = () => {
      cancelAnimationFrame(raf);
      el.style.transform = '';
    };

    window.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);

    return () => {
      window.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
      cancelAnimationFrame(raf);
    };
  }, [strength, range]);

  return ref;
}
