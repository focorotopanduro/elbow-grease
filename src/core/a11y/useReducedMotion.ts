/**
 * useReducedMotion — reactive reader of the `prefers-reduced-motion`
 * user preference.
 *
 * Phase 10.C consolidates the one that was living in
 * `src/ui/radial/usePrefersReducedMotion.ts` into `@core/a11y/` so
 * every surface of the app reads from the same hook. The old
 * location re-exports this for backward compat during one release.
 *
 * Semantics:
 *   • `true`  → user wants motion minimized. Skip continuous
 *     animation (pulses, scans), skip entry springs, keep fades
 *     short (<100ms) or replace with instant toggles.
 *   • `false` → motion is fine.
 *
 * Reactive: listens for the media query's change event so a user
 * toggling the OS preference mid-session gets an immediate update.
 */

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return reduced;
}

/**
 * Imperative counterpart for non-React code (useFrame callbacks,
 * raw DOM listeners). Reads the current value synchronously.
 *
 * Not reactive — the OS preference doesn't change per frame, so
 * callers that need live updates should use the hook. This function
 * exists so `useFrame`-based animation can branch on the flag without
 * owning its own subscription.
 */
export function isReducedMotionPreferred(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}
