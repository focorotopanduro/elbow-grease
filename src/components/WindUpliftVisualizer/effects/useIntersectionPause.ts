import { useEffect, useRef, useState } from 'react';

/**
 * Pauses scene animations when the element scrolls out of view.
 * Standard practice for keeping CPU/GPU cool and preserving battery on
 * laptops + phones — what Stripe, Linear, and Vercel use to keep their
 * showcase animations from cooking devices.
 */
export function useIntersectionPause<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) return;

    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Pause when less than 1% visible
          setPaused(entry.intersectionRatio < 0.01);
        }
      },
      { threshold: [0, 0.01, 0.1, 1] },
    );
    obs.observe(el);

    // Also pause when the tab is hidden
    const onVisibility = () => {
      if (document.hidden) setPaused(true);
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      obs.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return [ref, paused] as const;
}
