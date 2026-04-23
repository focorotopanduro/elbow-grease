/**
 * useAccentPulse — one-shot pulse scale when the workspace accent
 * changes while the radial menu is open.
 *
 * Reinforces mode-flip legibility at the point of interaction. The
 * radial menu statically picks up the accent color (cyan in
 * plumbing, orange in roofing) via `config.accentColor`; this hook
 * adds a brief visual acknowledgment that the flip just happened.
 *
 * ─── Behaviour ───────────────────────────────────────────────
 *
 *   • Returns `1` on the initial mount (no pulse when the menu
 *     first opens — the entry spring already covers that beat).
 *   • On every subsequent `accent` change, returns `1.08` for
 *     150ms then snaps back to `1`. Consumers pair this with a
 *     CSS / SVG `transition: transform 150ms ease-out` so the
 *     transition handles the up-and-back animation smoothly.
 *   • Returns `1` permanently when `prefers-reduced-motion` is
 *     set — vestibular-disorder users don't see movement.
 *
 * ─── Why not Web Animations API (`element.animate(...)`)? ────
 *
 * This hook returns a number for the caller to apply to whichever
 * SVG wrapper `<g>` holds the accent-colored elements. Keeping it
 * React-state-driven means the caller's render tree owns the
 * pulse value — no ref juggling, no imperative DOM calls, no
 * jsdom-support gymnastics in tests. The animation smoothness
 * comes from the consumer's CSS transition.
 *
 * ─── Why a two-step state change and not one? ────────────────
 *
 * Setting state to `1.08` and then (after timeout) back to `1`
 * gives React two commit phases. With a CSS transition on the
 * transform, the browser tweens between them — scale 1 → 1.08
 * over 150ms, then 1.08 → 1 over the next 150ms. Total visible
 * pulse: 300ms. A single state value combined with a CSS
 * `@keyframes` animation would also work, but would require a
 * keyed-remount trick to re-trigger; this is simpler.
 */

import { useEffect, useRef, useState } from 'react';

const PULSE_SCALE_PEAK = 1.08;
const PULSE_HOLD_MS = 150;

/**
 * Returns the current pulse scale multiplier — use this on a
 * `transform: scale(...)` style for the accent-bearing element.
 *
 * @param accent        Workspace accent hex. Changes trigger a pulse.
 * @param reducedMotion True when `prefers-reduced-motion: reduce`
 *                      is set. Hook returns 1 and runs no timers.
 */
export function useAccentPulse(accent: string, reducedMotion: boolean): number {
  const [scale, setScale] = useState(1);

  // Skip the pulse on the FIRST render — this hook runs when the
  // radial menu mounts, and the initial accent pickup isn't a
  // "change". We only want to pulse on subsequent changes while
  // the menu is already open (e.g. user presses Shift+M with the
  // wheel up).
  const firstAccentRef = useRef<string | null>(null);

  useEffect(() => {
    // Record the first accent without pulsing.
    if (firstAccentRef.current === null) {
      firstAccentRef.current = accent;
      return;
    }
    // Same accent on rerun (e.g. a reducedMotion flip) — skip.
    if (firstAccentRef.current === accent) return;

    firstAccentRef.current = accent;

    if (reducedMotion) {
      setScale(1);
      return;
    }

    setScale(PULSE_SCALE_PEAK);
    const t = window.setTimeout(() => setScale(1), PULSE_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [accent, reducedMotion]);

  return scale;
}

/** Exported for test introspection — consumers don't use these. */
export const __testables = {
  PULSE_SCALE_PEAK,
  PULSE_HOLD_MS,
};
