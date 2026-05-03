import { useEffect, useState } from 'react';

/**
 * Robust device classifier — returns true when the device is "sim-
 * capable" (can render the WindUplift simulator with reasonable UX).
 *
 * UPDATED in the responsive-controls overhaul: we lowered the bar
 * from "desktop only" (≥1024px + mouse + no touch) to "sim-capable"
 * (≥768px viewport, regardless of pointer or touch). This brings
 * tablets into the sim experience — they get the simulator with a
 * vertical-stacked control layout instead of being shunted to the
 * MobileLeadCapture form.
 *
 * Three categories now exist downstream:
 *   - PHONES (< 768px viewport):                MobileLeadCapture (form)
 *   - TABLETS (768–1023px):                     Sim with vertical controls
 *   - DESKTOPS (≥ 1024px + fine pointer):       Sim with horizontal sidebar HUD
 *
 * Network-quality kill-switch still applies: if the user has
 * Save-Data on or is on 2G, we drop them to the lead-capture form
 * regardless of viewport.
 *
 * `useDeviceTier` (separate hook below) returns the three-way
 * classification when the consumer needs the layout split. This
 * boolean returns whether the sim should render at all.
 */
export function useIsDesktop(): boolean | null {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);

  useEffect(() => {
    const detect = (): boolean => {
      // SSR safety
      if (typeof window === 'undefined') return false;

      // NETWORK-QUALITY KILL-SWITCH — if the user has Save-Data on or
      // is on a 2G connection, drop to the lead-capture form regardless
      // of viewport. Downloading the sim chunk + streaming weather
      // animations would burn their data + bog their browser.
      const conn = (navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }).connection;
      if (conn?.saveData) return false;
      if (conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g') return false;

      // VIEWPORT GATE — drop to ≥768px (was 1024px). This brings
      // tablets into the sim experience. Phones still go to the
      // lead-capture form because the controls + readouts simply
      // don't fit usefully in <768px even with vertical stacking.
      return window.innerWidth >= 768;
    };

    setIsDesktop(detect());

    // Re-evaluate on viewport resize (user rotates tablet, drags
    // browser to a different monitor, attaches/removes mouse).
    const handler = () => setIsDesktop(detect());
    window.addEventListener('resize', handler);
    const mq = window.matchMedia('(pointer: fine)');
    if (mq.addEventListener) mq.addEventListener('change', handler);

    return () => {
      window.removeEventListener('resize', handler);
      if (mq.removeEventListener) mq.removeEventListener('change', handler);
    };
  }, []);

  return isDesktop;
}

/**
 * Three-way device classification for the responsive sim layout.
 *
 *   - 'phone'    < 768px           → MobileLeadCapture (form only)
 *   - 'tablet'   768–1023px         → Sim with vertical-stacked controls
 *   - 'desktop'  ≥ 1024px + fine    → Sim with horizontal sidebar HUD
 *
 * Returns null during the first paint to avoid hydration mismatches.
 * Re-evaluates on viewport resize so the layout transitions smoothly
 * when a user rotates a tablet or resizes the browser window.
 */
export type DeviceTier = 'phone' | 'tablet' | 'desktop';

export function useDeviceTier(): DeviceTier | null {
  const [tier, setTier] = useState<DeviceTier | null>(null);

  useEffect(() => {
    const detect = (): DeviceTier => {
      if (typeof window === 'undefined') return 'phone';

      // Network-quality kill: down-tier to phone on slow / save-data
      const conn = (navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }).connection;
      if (conn?.saveData || conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g') {
        return 'phone';
      }

      const w = window.innerWidth;
      if (w < 768) return 'phone';
      if (w < 1024) return 'tablet';

      // Desktop tier requires fine pointer (rules out 1280px tablets
      // in landscape). Without fine pointer, classify as tablet.
      const finePointer =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: fine)').matches;
      return finePointer ? 'desktop' : 'tablet';
    };

    setTier(detect());

    const handler = () => setTier(detect());
    window.addEventListener('resize', handler);
    const mq = window.matchMedia('(pointer: fine)');
    if (mq.addEventListener) mq.addEventListener('change', handler);
    return () => {
      window.removeEventListener('resize', handler);
      if (mq.removeEventListener) mq.removeEventListener('change', handler);
    };
  }, []);

  return tier;
}
