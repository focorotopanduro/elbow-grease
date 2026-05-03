/**
 * RasterModeToast — brief overlay that confirms the toggle change.
 *
 * Appears for ~1.8s after Alt+R or programmatic toggle. Tells the
 * artist which mode they're now in so they don't have to hunt around
 * the scene to verify the toggle worked. Auto-dismisses; pointer-events
 * disabled so it never blocks interaction.
 *
 * On initial mount the toast does NOT show — only AFTER the first
 * actual toggle. Otherwise every page load with `?raster=off` would
 * flash a banner the user didn't trigger.
 */

import { useEffect, useRef, useState } from 'react';
import { useRasterMode, type RasterMode } from './useRasterMode';

const TOAST_VISIBLE_MS = 1800;

export function RasterModeToast() {
  const mode = useRasterMode();
  const [visible, setVisible] = useState(false);
  const lastModeRef = useRef<RasterMode>(mode);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    // Only fire on TRANSITIONS, not the initial mount.
    if (mode === lastModeRef.current) return;
    lastModeRef.current = mode;

    setVisible(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setVisible(false), TOAST_VISIBLE_MS);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [mode]);

  if (!visible) return null;

  return (
    <div className="rh-raster-toast" role="status" aria-live="polite">
      <span className="rh-raster-toast-eyebrow">Raster mode</span>
      <strong className="rh-raster-toast-mode">
        {mode === 'on' ? 'ON — painted PNGs' : 'OFF — SVG fallback'}
      </strong>
      <span className="rh-raster-toast-hint">Alt+R to toggle</span>
    </div>
  );
}
