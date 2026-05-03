import { useEffect, useRef, useState } from 'react';

/**
 * Adaptive quality controller. Monitors rolling FPS over the last ~30 frames
 * and emits a quality tier 0..1 (1 = full effects, 0 = reduced).
 *
 * - Detects sub-45 fps → drops tier
 * - Recovers to >55 fps → climbs tier
 * - Honors paused / reduced-motion → snaps to full quality (or zero)
 *
 * This is the same pattern Three.js, Babylon.js, and modern WebGL apps use
 * to keep frame rates smooth on lower-end hardware.
 */
export function useFpsMonitor(opts: { paused?: boolean; reducedMotion?: boolean } = {}) {
  const { paused = false, reducedMotion = false } = opts;
  const [quality, setQuality] = useState(1);
  const samples = useRef<number[]>([]);
  const lastTier = useRef(1);

  useEffect(() => {
    if (paused) return;
    if (reducedMotion) {
      setQuality(0.4);
      return;
    }

    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (dt > 0 && dt < 200) {
        samples.current.push(1000 / dt);
        if (samples.current.length > 30) samples.current.shift();
      }

      if (samples.current.length >= 30) {
        const avg = samples.current.reduce((a, b) => a + b, 0) / samples.current.length;
        let tier = lastTier.current;
        if (avg < 42 && tier > 0.4) tier = Math.max(0.4, tier - 0.2);
        else if (avg > 56 && tier < 1) tier = Math.min(1, tier + 0.1);
        if (tier !== lastTier.current) {
          lastTier.current = tier;
          setQuality(tier);
        }
        samples.current = samples.current.slice(15);
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, reducedMotion]);

  return quality;
}
