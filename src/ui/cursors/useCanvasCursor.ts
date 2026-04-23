/**
 * useCanvasCursor — reactive cursor string for the 3D canvas.
 *
 * Subscribes to the three stores that determine the cursor state:
 *
 *   • `appModeStore.mode`       — which workspace accent to use
 *   • `plumbingDrawStore.mode`  — is plumbing in draw mode?
 *   • `roofingDrawStore.mode`   — is roofing in draw-rect /
 *                                  draw-polygon / place-penetration?
 *
 * Returns a ready-to-apply CSS `cursor` value. Callers wire it
 * into the canvas wrapper's inline style:
 *
 *     const cursor = useCanvasCursor();
 *     return <div style={{ ...rest, cursor }}>…<Canvas /></div>;
 *
 * The heavy lifting (SVG data URL construction, mode logic) lives
 * in the pure `modeCursor` module. This hook is only the Zustand
 * wiring — keeps reactivity concerns separate from string-building
 * concerns, so the pure helpers stay unit-testable without a DOM.
 */

import { useAppModeStore } from '@store/appModeStore';
import { usePlumbingDrawStore } from '@store/plumbingDrawStore';
import { useRoofingDrawStore } from '@store/roofingDrawStore';
import { resolveCursorCss } from './modeCursor';

export function useCanvasCursor(): string {
  // Subscribe to the three primitive fields. Returning individual
  // strings (rather than a composed object) keeps Zustand's
  // reference-equality happy — no array/object allocation per render.
  const appMode = useAppModeStore((s) => s.mode);
  const plumbingMode = usePlumbingDrawStore((s) => s.mode);
  const roofingMode = useRoofingDrawStore((s) => s.mode);
  return resolveCursorCss({ appMode, plumbingMode, roofingMode });
}
