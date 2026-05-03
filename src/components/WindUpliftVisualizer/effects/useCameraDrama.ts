import { useEffect, useRef, useState } from 'react';
import type { CascadeResult } from '../../../physics/cascade';

export type DramaKind = null | 'shingles' | 'sheathing';

/**
 * useCameraDrama — fires a one-shot camera lurch when the failure cascade
 * crosses a key threshold. Returns a string the parent applies as a
 * className on the viz container; the CSS keyframes do the actual motion.
 *
 *   - shingles_lifting (first  shingles flutter)  → 700ms light lurch
 *   - sheathing_gone   (catastrophic deck blow)   → 1000ms heavy lurch
 *
 * Edge-triggered: only fires on the false→true transition, so dragging the
 * slider back and forth doesn't re-shake the camera. Ignores reduced-motion
 * — the CSS keyframes themselves are gated by a `@media (prefers-reduced-
 * motion: reduce)` rule, so users who opted out get no animation even when
 * the className is applied.
 */
export function useCameraDrama(cascade: CascadeResult): DramaKind {
  const [kind, setKind] = useState<DramaKind>(null);
  const prev = useRef({ shingles: false, sheathing: false });
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const triggered = (id: string) =>
      cascade.stages.find((s) => s.id === id)?.triggered ?? false;

    const shingles = triggered('field_shingles');
    const sheathing = triggered('sheathing');

    let next: DramaKind = null;
    let dur = 0;
    // sheathing wins — it's the bigger event
    if (sheathing && !prev.current.sheathing) {
      next = 'sheathing';
      dur = 1000;
    } else if (shingles && !prev.current.shingles) {
      next = 'shingles';
      dur = 700;
    }

    if (next) {
      setKind(next);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setKind(null), dur);
    }

    prev.current = { shingles, sheathing };
    return () => {
      if (timer.current) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [cascade]);

  return kind;
}
