import { useEffect, useRef, useState } from 'react';

export interface RainDrop {
  x: number;
  y: number;
  len: number;
  vx: number;
  vy: number;
  layer: 0 | 1 | 2; // 0=far, 1=mid, 2=near (parallax depth)
}

interface Splash {
  x: number;
  y: number;
  born: number;
}

interface RainState {
  drops: RainDrop[];
  splashes: Splash[];
}

/**
 * Multi-layer particle rain system with depth parallax + ground splash.
 *
 * Standard particle-system pattern:
 *   - Pool of N particles re-used (no GC churn)
 *   - Each frame: integrate velocity, wrap on screen exit
 *   - Splash spawned when particle hits ground line, expires after ~250ms
 *   - 3 depth layers: far is dim + slow, near is bright + fast (parallax)
 *
 * Throttled by reduced-motion + paused + adaptive quality.
 */
export function useRainParticles(
  intensity: number,            // 0-1
  windStrength: number,         // 0-1.5+
  quality: number = 1,          // 0-1 from FPS monitor
  options: { paused?: boolean; reducedMotion?: boolean; groundY?: number } = {},
): RainState {
  const { paused, reducedMotion, groundY = 438 } = options;
  const [state, setState] = useState<RainState>({ drops: [], splashes: [] });

  const dropsRef = useRef<RainDrop[]>([]);
  const splashesRef = useRef<Splash[]>([]);

  // Adjust pool size to match intensity * quality.
  // Lower max keeps DOM diff cheap and avoids visible flicker.
  const targetCount = Math.round(intensity * 70 * quality);

  useEffect(() => {
    // grow / shrink pool to match target
    const cur = dropsRef.current;
    if (cur.length < targetCount) {
      for (let i = cur.length; i < targetCount; i++) {
        cur.push(spawn(true));
      }
    } else if (cur.length > targetCount) {
      cur.length = targetCount;
    }
  }, [targetCount]);

  useEffect(() => {
    if (paused || reducedMotion || intensity <= 0) {
      dropsRef.current = [];
      splashesRef.current = [];
      setState({ drops: [], splashes: [] });
      return;
    }

    let raf = 0;
    let last = performance.now();
    let lastPaint = 0;
    const PAINT_INTERVAL_MS = 33; // throttle React renders to ~30fps to kill flicker

    const tick = (now: number) => {
      const dt = Math.min(64, now - last) / 1000;
      last = now;

      const angle = 0.25 + windStrength * 0.35; // radians, increases with wind
      const baseV = 800 + windStrength * 600;
      const newSplashes = splashesRef.current.filter((s) => now - s.born < 320);

      for (const d of dropsRef.current) {
        const layerSpeed = d.layer === 0 ? 0.55 : d.layer === 1 ? 0.8 : 1.05;
        d.vy = baseV * layerSpeed;
        d.vx = baseV * Math.sin(angle) * 0.9 * layerSpeed;
        d.y += d.vy * dt;
        d.x += d.vx * dt;

        if (d.y > groundY) {
          if (d.layer >= 1 && newSplashes.length < 24 && d.x > 0 && d.x < 800) {
            newSplashes.push({ x: d.x, y: groundY, born: now });
          }
          Object.assign(d, spawn(false));
        }
        if (d.x > 820) {
          Object.assign(d, spawn(false));
        }
      }

      splashesRef.current = newSplashes;

      // Throttle the React re-render — physics ticks every frame, paint every ~30ms
      if (now - lastPaint > PAINT_INTERVAL_MS) {
        lastPaint = now;
        setState({ drops: dropsRef.current.slice(), splashes: splashesRef.current.slice() });
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [intensity, windStrength, paused, reducedMotion, groundY]);

  return state;
}

function spawn(initial: boolean): RainDrop {
  const layer = (Math.random() < 0.4 ? 0 : Math.random() < 0.7 ? 1 : 2) as 0 | 1 | 2;
  return {
    x: Math.random() * 900 - 100,
    y: initial ? Math.random() * 440 : -20 - Math.random() * 60,
    len: layer === 0 ? 6 : layer === 1 ? 10 : 14,
    vx: 0,
    vy: 0,
    layer,
  };
}
