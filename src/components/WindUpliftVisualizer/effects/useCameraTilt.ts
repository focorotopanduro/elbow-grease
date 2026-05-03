import { useEffect, useRef } from 'react';
import { useReducedMotion } from './useReducedMotion';

/**
 * useCameraTilt — pointer-driven 3D-camera tilt for the visualizer scene.
 *
 * Tracks the user's pointer position over the returned ref'd container and
 * writes three CSS custom properties:
 *   --cam-tilt-x       (deg, -max…+max)  ← rotateY on the SVG
 *   --cam-tilt-y       (deg, -max/2…+max/2) ← rotateX on the SVG
 *   --cam-parallax-x   (-1…+1)            ← raw horizontal weight for SVG-internal parallax
 *
 * The CSS at `.wuv__viz .rh-svg` consumes those vars to apply a perspective
 * rotation. Inside the SVG, individual layers (palms, clouds) read
 * `--cam-parallax-x` to translate at different rates = real parallax depth.
 *
 * Touch / pen devices never fire `pointermove` over a non-pressed pointer,
 * so on phones the vars stay at 0 = no tilt. `prefers-reduced-motion` users
 * also get no tilt. Updates are throttled through requestAnimationFrame so
 * we never cost more than one style write per frame.
 */
export function useCameraTilt<T extends HTMLElement>(maxTiltDeg = 5) {
  const ref = useRef<T>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;

    let raf = 0;
    let pendingX = 0;
    let pendingY = 0;
    let pendingP = 0;

    const flush = () => {
      raf = 0;
      el.style.setProperty('--cam-tilt-x', pendingX.toFixed(2) + 'deg');
      el.style.setProperty('--cam-tilt-y', pendingY.toFixed(2) + 'deg');
      el.style.setProperty('--cam-parallax-x', pendingP.toFixed(3));
    };

    const onMove = (e: PointerEvent) => {
      // Only respond to fine pointers (mouse/trackpad). Touch returns
      // pointerType === 'touch' but we still want to ignore drag-style
      // moves so the tilt doesn't fight scrolling.
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      const rect = el.getBoundingClientRect();
      const cx = (e.clientX - rect.left) / rect.width;   // 0…1
      const cy = (e.clientY - rect.top) / rect.height;   // 0…1
      const nx = (cx - 0.5) * 2;                          // -1…+1
      const ny = (cy - 0.5) * 2;                          // -1…+1
      pendingX = nx * maxTiltDeg;
      // Vertical tilt is half-amplitude + inverted (mouse down = tilt back)
      pendingY = -ny * (maxTiltDeg * 0.5);
      pendingP = nx;
      if (!raf) raf = requestAnimationFrame(flush);
    };

    const onLeave = () => {
      pendingX = 0;
      pendingY = 0;
      pendingP = 0;
      if (!raf) raf = requestAnimationFrame(flush);
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced, maxTiltDeg]);

  return ref;
}
