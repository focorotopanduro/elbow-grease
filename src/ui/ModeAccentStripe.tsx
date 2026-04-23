/**
 * ModeAccentStripe — thin workspace-accent strip along the top of
 * the viewport, always visible.
 *
 * Purpose: instant mode legibility. Users running high-tempo
 * plumbing + roofing jobs in the same session need to know which
 * trade's tools are armed *before* they look at the toolbar.
 * Peripheral-vision cue — 3px of saturated color at the very top
 * of the screen, pinned above every other UI layer.
 *
 * Cost: 3 pixels of vertical space, one `<div>`, cheap Zustand
 * subscription to `appMode`. Turns off completely if the mode
 * store somehow returns an unknown value.
 */

import { useAppModeStore, APP_MODE_ACCENTS } from '@store/appModeStore';

export function ModeAccentStripe() {
  const mode = useAppModeStore((s) => s.mode);
  const accent = APP_MODE_ACCENTS[mode];
  if (!accent) return null;
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0,
        height: 3,
        background: accent,
        // Sits above the 3D canvas + all HUDs. Non-interactive so
        // it can't swallow pointer events from anything below it.
        pointerEvents: 'none',
        zIndex: 100,
        // Smooth transition when the mode flips — a half-second
        // colour sweep draws the eye to the top of the screen and
        // doubles as a subtle acknowledgement of the toggle.
        transition: 'background 300ms ease',
      }}
    />
  );
}
