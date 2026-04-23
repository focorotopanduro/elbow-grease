/**
 * modeCursor — workspace-accent-tinted draw cursor.
 *
 * When the user is in a draw mode (plumbing `'draw'`, roofing
 * `'draw-rect'` / `'draw-polygon'` / `'place-penetration'`), the 3D
 * canvas swaps its cursor for a crosshair tinted in the active
 * workspace accent. Cyan in plumbing, orange in roofing — matches
 * the accent stripe, status bar, panel borders, and radial menu
 * the rest of the chrome already carries.
 *
 * Why a custom cursor:
 *
 *   • The native `crosshair` cursor is a thin grey + does NOT
 *     announce workspace. A worker flipping between plumbing and
 *     roofing draws at high tempo loses track of which tool is
 *     armed without a chrome glance — the cursor is the fastest
 *     mode-check surface because the eye is already there.
 *   • The accent color connects the pointer to the rest of the
 *     mode-legibility system, so the workspace identity is carried
 *     on the pointer itself, not just the periphery.
 *
 * Design:
 *
 *   • 32×32 SVG, hotspot (16, 16) — dead center.
 *   • 10px gap arms on each axis, leaving the precision-critical
 *     center pixel uncovered so the user can SEE what they're
 *     pointing at.
 *   • Each arm draws TWICE: a thicker `#0a0a0f` outline first,
 *     then a thinner accent-colored line on top. The outline
 *     keeps the crosshair visible when it passes over a bright
 *     surface (white drywall, a lit fixture, the default grid).
 *   • A 1.5px accent center-dot with a thin dark outline — lets
 *     the user see where the click will land.
 *   • No animation → no `prefers-reduced-motion` gate needed.
 *
 * Falls back to the native `crosshair` cursor when the data URL
 * fails to load (rare: CSP-restricted browser configs, headless
 * mode, etc.). In non-draw modes we emit `'auto'` so R3F's own
 * pointer-event cursors (grab on drag, etc.) win.
 *
 * Pure module — accepts the state as arguments, returns a string.
 * React subscription lives in `useCanvasCursor`.
 */

import { APP_MODE_ACCENTS, type AppMode } from '@store/appModeStore';

// Plumbing mode string-literal union, matching plumbingDrawStore.
// Mirrored here instead of imported so the pure module stays
// import-graph-light (typecheck doesn't drag in a store just to
// know the string values).
export type PlumbingSubMode = 'navigate' | 'draw' | 'select';

// Roofing mode string-literal union, matching roofingDrawStore.
export type RoofingSubMode =
  | 'idle'
  | 'draw-rect'
  | 'draw-polygon'
  | 'place-penetration';

export interface ModeCursorInput {
  appMode: AppMode;
  plumbingMode: PlumbingSubMode;
  roofingMode: RoofingSubMode;
}

/**
 * Returns true iff the current mode state describes an active
 * drawing interaction. Matches the logic in
 * `@core/selectors/isAnyDrawActive` but is pure (no getState()
 * calls) so it's testable in isolation.
 */
export function shouldShowDrawCursor(input: ModeCursorInput): boolean {
  if (input.appMode === 'plumbing') return input.plumbingMode === 'draw';
  if (input.appMode === 'roofing') return input.roofingMode !== 'idle';
  return false;
}

/**
 * Build the cursor SVG's data URL for a given accent color. The
 * SVG itself is fully static except for the accent swap.
 *
 * `#` in the accent hex must be URL-encoded as `%23`, otherwise
 * the browser treats the rest of the URL as a fragment and the
 * SVG fails to load — you get the fallback `crosshair` instead
 * of a tinted one.
 */
export function buildCrosshairDataUrl(accent: string): string {
  // URL-encode `#` → `%23`. We don't hit any other special chars
  // in a 6-digit hex; accept the narrow input shape.
  const enc = accent.replace('#', '%23');
  // Keep SVG compact — some browsers cap data-URL cursors at
  // ~2KB. We're well under at ~500 chars.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
      // Outline layer — dark stroke for contrast on bright scene surfaces.
      '<g stroke="%230a0a0f" stroke-width="3" stroke-linecap="round" fill="none">' +
        '<line x1="16" y1="2" x2="16" y2="12"/>' +
        '<line x1="16" y1="20" x2="16" y2="30"/>' +
        '<line x1="2" y1="16" x2="12" y2="16"/>' +
        '<line x1="20" y1="16" x2="30" y2="16"/>' +
      '</g>' +
      // Accent layer — thinner stroke in the workspace color, sits on top.
      '<g stroke="' + enc + '" stroke-width="1.5" stroke-linecap="round" fill="none">' +
        '<line x1="16" y1="2" x2="16" y2="12"/>' +
        '<line x1="16" y1="20" x2="16" y2="30"/>' +
        '<line x1="2" y1="16" x2="12" y2="16"/>' +
        '<line x1="20" y1="16" x2="30" y2="16"/>' +
      '</g>' +
      // Center dot — accent fill over a 1px dark outline.
      '<circle cx="16" cy="16" r="1.5" fill="' + enc + '" stroke="%230a0a0f" stroke-width="0.75"/>' +
    '</svg>';
  return 'data:image/svg+xml;utf8,' + svg;
}

/**
 * Resolve the full CSS `cursor` property value for the current
 * mode state. Returns one of:
 *
 *   • `'auto'` — not in a draw mode; defer to R3F / browser default.
 *   • `'url("data:image/svg+xml;utf8,...") 16 16, crosshair'` — draw
 *     mode active in the current workspace; accent-tinted crosshair
 *     centered on the hotspot, with `crosshair` as a safety fallback.
 *
 * Callers apply the returned string directly to `style.cursor` on
 * the canvas wrapper div.
 */
export function resolveCursorCss(input: ModeCursorInput): string {
  if (!shouldShowDrawCursor(input)) return 'auto';
  const accent = APP_MODE_ACCENTS[input.appMode];
  const dataUrl = buildCrosshairDataUrl(accent);
  // Hotspot = (16, 16) — SVG center. Fallback to native `crosshair`
  // so browsers that can't load the data URL still get the right
  // precision-targeting affordance.
  return `url("${dataUrl}") 16 16, crosshair`;
}
