import { useEffect, useRef, useState } from 'react';

interface WindState {
  /** Continuous baseline wind 0-1, derived from V */
  baseline: number;
  /** Current gust amplitude 0-1 (above baseline). Pulses periodically. */
  gust: number;
  /** Combined wind 0-1.6 (gust can push past baseline) */
  current: number;
  /** A continuously-shifting noise value -1..+1 used for organic motion */
  noise: number;
}

/**
 * Central wind orchestrator. Produces an updated wind state every animation
 * frame, throttled by `prefers-reduced-motion` and the supplied `paused` flag.
 *
 * The output is composed of:
 *   - Baseline wind from the user's V (slow-changing)
 *   - Periodic gusts: amplitude scales with baseline, frequency every ~3-7s
 *   - Organic noise (low-frequency sine sum) for sway and streamline jitter
 *
 * All the wind-affected visuals (palm sway, smoke bend, streamline drift,
 * rain angle, leaf trajectory) consume this single value so they all move
 * in sympathy — the production motion-design pattern from cinema & gaming.
 */
export function useWindEngine(
  baseline: number,
  options: { paused?: boolean; reducedMotion?: boolean } = {},
): WindState {
  const { paused = false, reducedMotion = false } = options;
  const [state, setState] = useState<WindState>({
    baseline,
    gust: 0,
    current: baseline,
    noise: 0,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  // Gust scheduler: schedules a gust event every ~3-7s (faster at higher wind)
  const gustTargetRef = useRef(0);
  const gustVelRef = useRef(0);
  const nextGustRef = useRef(performance.now() + 4000);

  useEffect(() => {
    if (paused || reducedMotion) {
      setState((s) => ({ ...s, baseline, gust: 0, current: baseline, noise: 0 }));
      return;
    }

    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(64, now - last) / 1000; // seconds, clamp to 16fps min
      last = now;

      // schedule gusts
      if (now > nextGustRef.current) {
        gustTargetRef.current = 0.25 + Math.random() * 0.45 * (0.4 + baseline);
        // higher V → more frequent gusts
        const interval = 2500 + Math.random() * (5500 - baseline * 3500);
        nextGustRef.current = now + interval;
      }

      // damped spring toward gust target, then decay back to 0
      const target = gustTargetRef.current * Math.exp(-(now - (nextGustRef.current - 4000)) / 1200);
      const stiffness = 18;
      const damping = 6;
      const cur = stateRef.current.gust;
      const accel = (target - cur) * stiffness - gustVelRef.current * damping;
      gustVelRef.current += accel * dt;
      const newGust = Math.max(0, cur + gustVelRef.current * dt);

      // organic noise: sum of three sines (low-frequency)
      const t = now / 1000;
      const noise =
        Math.sin(t * 0.7) * 0.5 +
        Math.sin(t * 1.6 + 1.2) * 0.3 +
        Math.sin(t * 2.9 + 2.7) * 0.2;

      setState({
        baseline,
        gust: newGust,
        current: baseline + newGust * (0.3 + baseline * 0.5),
        noise,
      });

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [baseline, paused, reducedMotion]);

  return state;
}
