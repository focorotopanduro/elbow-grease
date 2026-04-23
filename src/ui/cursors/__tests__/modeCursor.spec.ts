/**
 * modeCursor — unit tests for the pure cursor-resolution helpers.
 *
 * The three things this module is responsible for:
 *
 *   1. Mode-state → boolean decision (`shouldShowDrawCursor`).
 *   2. Accent color → data URL building (`buildCrosshairDataUrl`).
 *   3. Full CSS cursor string composition (`resolveCursorCss`).
 *
 * Hook wiring (`useCanvasCursor`) is trivial Zustand subscription;
 * not worth a test here — its correctness is covered by the
 * individual store hooks + this module's outputs.
 */

import { describe, it, expect } from 'vitest';
import {
  shouldShowDrawCursor,
  buildCrosshairDataUrl,
  resolveCursorCss,
  type ModeCursorInput,
} from '../modeCursor';
import { APP_MODE_ACCENTS } from '@store/appModeStore';

const baseInput: ModeCursorInput = {
  appMode: 'plumbing',
  plumbingMode: 'navigate',
  roofingMode: 'idle',
};

// ── shouldShowDrawCursor ─────────────────────────────────────

describe('shouldShowDrawCursor — draw-mode detection', () => {
  it('returns false in plumbing navigate mode', () => {
    expect(shouldShowDrawCursor({ ...baseInput, plumbingMode: 'navigate' })).toBe(false);
  });

  it('returns false in plumbing select mode', () => {
    expect(shouldShowDrawCursor({ ...baseInput, plumbingMode: 'select' })).toBe(false);
  });

  it('returns true in plumbing draw mode', () => {
    expect(shouldShowDrawCursor({ ...baseInput, plumbingMode: 'draw' })).toBe(true);
  });

  it('returns false in roofing idle mode', () => {
    expect(shouldShowDrawCursor({
      appMode: 'roofing',
      plumbingMode: 'navigate',
      roofingMode: 'idle',
    })).toBe(false);
  });

  it('returns true in roofing draw-rect mode', () => {
    expect(shouldShowDrawCursor({
      appMode: 'roofing',
      plumbingMode: 'navigate',
      roofingMode: 'draw-rect',
    })).toBe(true);
  });

  it('returns true in roofing draw-polygon mode', () => {
    expect(shouldShowDrawCursor({
      appMode: 'roofing',
      plumbingMode: 'navigate',
      roofingMode: 'draw-polygon',
    })).toBe(true);
  });

  it('returns true in roofing place-penetration mode', () => {
    expect(shouldShowDrawCursor({
      appMode: 'roofing',
      plumbingMode: 'navigate',
      roofingMode: 'place-penetration',
    })).toBe(true);
  });

  it('ignores plumbing draw mode when appMode is roofing (mode-gating)', () => {
    // If the user is on roofing workspace, we don't care that the
    // plumbing store still carries 'draw' from a previous session.
    expect(shouldShowDrawCursor({
      appMode: 'roofing',
      plumbingMode: 'draw',
      roofingMode: 'idle',
    })).toBe(false);
  });

  it('ignores roofing draw state when appMode is plumbing', () => {
    expect(shouldShowDrawCursor({
      appMode: 'plumbing',
      plumbingMode: 'navigate',
      roofingMode: 'draw-rect',
    })).toBe(false);
  });
});

// ── buildCrosshairDataUrl ────────────────────────────────────

describe('buildCrosshairDataUrl — SVG data URL shape', () => {
  it('returns a data:image/svg+xml; URL', () => {
    const url = buildCrosshairDataUrl('#00e5ff');
    expect(url.startsWith('data:image/svg+xml;utf8,')).toBe(true);
  });

  it('URL-encodes the `#` in the accent hex to `%23`', () => {
    const url = buildCrosshairDataUrl('#00e5ff');
    // No unescaped `#` should remain — otherwise the browser would
    // parse the rest of the URL as a fragment identifier.
    // (The one `#` in `data:image/svg+xml;utf8,<svg...>` doesn't
    // appear; `#` only enters via our colours.)
    expect(url.includes('#00e5ff')).toBe(false);
    expect(url.includes('%2300e5ff')).toBe(true);
  });

  it('embeds the dark contrast outline (#0a0a0f → %230a0a0f)', () => {
    const url = buildCrosshairDataUrl('#00e5ff');
    expect(url.includes('%230a0a0f')).toBe(true);
  });

  it('contains the 32×32 viewBox + four crosshair arms + center dot', () => {
    const url = buildCrosshairDataUrl('#ff9800');
    expect(url.includes('width="32"')).toBe(true);
    expect(url.includes('height="32"')).toBe(true);
    expect(url.includes('viewBox="0 0 32 32"')).toBe(true);
    // Each arm renders twice (outline + accent) → 8 total line elements.
    const lineCount = (url.match(/<line /g) ?? []).length;
    expect(lineCount).toBe(8);
    expect(url.includes('<circle')).toBe(true);
  });

  it('swaps accent color (different hex yields different URL)', () => {
    const cyan = buildCrosshairDataUrl(APP_MODE_ACCENTS.plumbing);
    const orange = buildCrosshairDataUrl(APP_MODE_ACCENTS.roofing);
    expect(cyan).not.toBe(orange);
    expect(cyan.includes('%2300e5ff')).toBe(true);
    expect(orange.includes('%23ff9800')).toBe(true);
  });

  it('stays under the 2KB data-URL cursor limit', () => {
    const url = buildCrosshairDataUrl('#00e5ff');
    // Firefox + Safari cap cursor data URLs at ~2KB. Our SVG should
    // be well under — this guards against future bloat.
    expect(url.length).toBeLessThan(2000);
  });
});

// ── resolveCursorCss ─────────────────────────────────────────

describe('resolveCursorCss — full CSS cursor value', () => {
  it('returns "auto" outside of any draw mode', () => {
    expect(resolveCursorCss(baseInput)).toBe('auto');
  });

  it('returns a url(...) cursor with hotspot 16 16 + crosshair fallback in plumbing draw', () => {
    const css = resolveCursorCss({ ...baseInput, plumbingMode: 'draw' });
    expect(css.startsWith('url("data:image/svg+xml;utf8,')).toBe(true);
    expect(css.endsWith(' 16 16, crosshair')).toBe(true);
  });

  it('uses the plumbing accent in plumbing draw mode', () => {
    const css = resolveCursorCss({ ...baseInput, plumbingMode: 'draw' });
    expect(css.includes('%2300e5ff')).toBe(true);
    expect(css.includes('%23ff9800')).toBe(false);
  });

  it('uses the roofing accent in roofing draw-rect mode', () => {
    const css = resolveCursorCss({
      appMode: 'roofing',
      plumbingMode: 'navigate',
      roofingMode: 'draw-rect',
    });
    expect(css.includes('%23ff9800')).toBe(true);
    expect(css.includes('%2300e5ff')).toBe(false);
  });

  it('honors the active workspace when both stores report draw state', () => {
    // If the plumbing store still carries 'draw' from a prior
    // session but the user is on roofing, the cursor should be
    // based on roofing's state (idle → no custom cursor).
    const css = resolveCursorCss({
      appMode: 'roofing',
      plumbingMode: 'draw',
      roofingMode: 'idle',
    });
    expect(css).toBe('auto');
  });

  it('returns a custom cursor for every roofing draw sub-mode', () => {
    const subs = ['draw-rect', 'draw-polygon', 'place-penetration'] as const;
    for (const sub of subs) {
      const css = resolveCursorCss({
        appMode: 'roofing',
        plumbingMode: 'navigate',
        roofingMode: sub,
      });
      expect(css.startsWith('url("data:')).toBe(true);
      expect(css.includes('%23ff9800')).toBe(true);
    }
  });
});
