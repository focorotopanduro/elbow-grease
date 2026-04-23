/**
 * accentContrast — unit tests.
 *
 * Pinned invariants:
 *
 *   1. Existing plumbing cyan `#00e5ff` → `#0a0a0f` (dark text)
 *      — migration guarantee, no behaviour change for callers.
 *   2. Existing roofing orange `#ff9800` → `#0a0a0f` (dark text)
 *      — same migration guarantee.
 *   3. Canonical dark accents (navy, maroon, forest) → `#ffffff`.
 *   4. Canonical bright accents (yellow, white, light-cyan) →
 *      `#0a0a0f`.
 *   5. Hex parser handles `#RRGGBB`, `#rgb`, no-hash, mixed case.
 *   6. Invalid input falls back to dark text (conservative default).
 *   7. Luminance function returns 0 for black, 1 for white, and
 *      the documented CIE-Y coefficients for the primaries.
 */

import { describe, it, expect } from 'vitest';
import {
  getReadableText,
  parseHexRgb,
  relativeLuminance,
  contrastRatio,
  DARK_TEXT,
  LIGHT_TEXT,
} from '../accentContrast';
import { APP_MODE_ACCENTS } from '@store/appModeStore';

// ── Migration guarantees ──────────────────────────────────────
//
// These are the two most important tests. If they fail, existing
// callsites that switch from hardcoded `#0a0a0f` to
// `getReadableText(accent)` will visually change — and the whole
// point of this helper is that migrating is a no-op for the two
// current accents.

describe('getReadableText — migration guarantees for current accents', () => {
  it('plumbing cyan (#00e5ff) → dark text', () => {
    expect(getReadableText(APP_MODE_ACCENTS.plumbing)).toBe(DARK_TEXT);
  });

  it('roofing orange (#ff9800) → dark text', () => {
    expect(getReadableText(APP_MODE_ACCENTS.roofing)).toBe(DARK_TEXT);
  });
});

// ── Luminance threshold behaviour ─────────────────────────────

describe('getReadableText — dim accents get light text', () => {
  it('navy (#001a4f) → white text', () => {
    expect(getReadableText('#001a4f')).toBe(LIGHT_TEXT);
  });

  it('maroon (#4a0e1a) → white text', () => {
    expect(getReadableText('#4a0e1a')).toBe(LIGHT_TEXT);
  });

  it('forest green (#1a3b1a) → white text', () => {
    expect(getReadableText('#1a3b1a')).toBe(LIGHT_TEXT);
  });

  it('pure black (#000000) → white text', () => {
    expect(getReadableText('#000000')).toBe(LIGHT_TEXT);
  });
});

describe('getReadableText — bright accents get dark text', () => {
  it('pure yellow (#ffff00) → dark text', () => {
    expect(getReadableText('#ffff00')).toBe(DARK_TEXT);
  });

  it('pure white (#ffffff) → dark text', () => {
    expect(getReadableText('#ffffff')).toBe(DARK_TEXT);
  });

  it('light cyan (#b2ebf2) → dark text', () => {
    expect(getReadableText('#b2ebf2')).toBe(DARK_TEXT);
  });

  it('light green (#c8e6c9) → dark text', () => {
    expect(getReadableText('#c8e6c9')).toBe(DARK_TEXT);
  });
});

// ── Hex parsing ───────────────────────────────────────────────

describe('parseHexRgb — input shapes', () => {
  it('parses #RRGGBB', () => {
    expect(parseHexRgb('#00e5ff')).toEqual({ r: 0, g: 229, b: 255 });
  });

  it('parses RRGGBB (no hash)', () => {
    expect(parseHexRgb('00e5ff')).toEqual({ r: 0, g: 229, b: 255 });
  });

  it('parses #rgb shortform', () => {
    // #0cf expands to #00ccff.
    expect(parseHexRgb('#0cf')).toEqual({ r: 0, g: 204, b: 255 });
  });

  it('parses rgb shortform without hash', () => {
    expect(parseHexRgb('0cf')).toEqual({ r: 0, g: 204, b: 255 });
  });

  it('is case-insensitive (uppercase hex)', () => {
    expect(parseHexRgb('#FF9800')).toEqual({ r: 255, g: 152, b: 0 });
  });

  it('is case-insensitive (mixed case)', () => {
    expect(parseHexRgb('#00E5Ff')).toEqual({ r: 0, g: 229, b: 255 });
  });

  it('trims whitespace', () => {
    expect(parseHexRgb('  #00e5ff  ')).toEqual({ r: 0, g: 229, b: 255 });
  });

  it('rejects 8-digit hex (alpha not supported)', () => {
    expect(parseHexRgb('#00e5ff80')).toBeNull();
  });

  it('rejects rgb() functional notation', () => {
    expect(parseHexRgb('rgb(0, 229, 255)')).toBeNull();
  });

  it('rejects named colors', () => {
    expect(parseHexRgb('cyan')).toBeNull();
  });

  it('rejects non-hex characters', () => {
    expect(parseHexRgb('#00zxff')).toBeNull();
  });

  it('rejects empty string', () => {
    expect(parseHexRgb('')).toBeNull();
  });
});

// ── Fallback behaviour ────────────────────────────────────────

describe('getReadableText — invalid input falls back to DARK_TEXT', () => {
  it('falls back on garbage input', () => {
    expect(getReadableText('not-a-color')).toBe(DARK_TEXT);
  });

  it('falls back on empty string', () => {
    expect(getReadableText('')).toBe(DARK_TEXT);
  });

  it('falls back on 8-digit hex (alpha unsupported)', () => {
    expect(getReadableText('#00e5ff80')).toBe(DARK_TEXT);
  });
});

// ── Luminance arithmetic ──────────────────────────────────────

describe('relativeLuminance — WCAG 2.1 formula', () => {
  it('returns 0 for pure black', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
  });

  it('returns 1 for pure white', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });

  it('returns the CIE Y coefficient for pure red (0.2126)', () => {
    expect(relativeLuminance({ r: 255, g: 0, b: 0 })).toBeCloseTo(0.2126, 4);
  });

  it('returns the CIE Y coefficient for pure green (0.7152)', () => {
    expect(relativeLuminance({ r: 0, g: 255, b: 0 })).toBeCloseTo(0.7152, 4);
  });

  it('returns the CIE Y coefficient for pure blue (0.0722)', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 255 })).toBeCloseTo(0.0722, 4);
  });

  it('mid-grey (#808080) sits around 0.22 (not 0.5 — sRGB curve is non-linear)', () => {
    // 128/255 ≈ 0.502 in linear space; sRGB → linear curve brings
    // it down to ~0.22. Documented as a trap for readers who expect
    // the eye-perceived midpoint.
    const L = relativeLuminance({ r: 128, g: 128, b: 128 });
    expect(L).toBeGreaterThan(0.2);
    expect(L).toBeLessThan(0.25);
  });
});

// ── Contrast ratio arithmetic ─────────────────────────────────

describe('contrastRatio — WCAG 2.1 formula', () => {
  it('returns 21 for black vs white (the maximum)', () => {
    expect(contrastRatio(0, 1)).toBe(21);
  });

  it('returns 1 for identical luminances', () => {
    expect(contrastRatio(0.5, 0.5)).toBe(1);
  });

  it('is order-independent', () => {
    expect(contrastRatio(0.2, 0.8)).toBe(contrastRatio(0.8, 0.2));
  });

  it('dark-text vs roofing-orange meets WCAG AAA (≥7)', () => {
    // Real-world pin: this is the assertion that the #0a0a0f on
    // orange pattern used across ModeTabs / InteractiveButton is
    // actually accessible, not just "we picked it".
    const L_orange = relativeLuminance(parseHexRgb('#ff9800')!);
    const L_dark = relativeLuminance(parseHexRgb('#0a0a0f')!);
    expect(contrastRatio(L_orange, L_dark)).toBeGreaterThanOrEqual(7);
  });

  it('white-text vs roofing-orange FAILS WCAG AA (<4.5)', () => {
    // The counter-assertion: if we'd picked white text on orange,
    // we'd have failed accessibility. This test guards against a
    // naive "use white text on everything" refactor.
    const L_orange = relativeLuminance(parseHexRgb('#ff9800')!);
    const L_light = relativeLuminance(parseHexRgb('#ffffff')!);
    expect(contrastRatio(L_orange, L_light)).toBeLessThan(4.5);
  });
});

// ── Migration sanity at module level ──────────────────────────

describe('all current accents pick a text color that actually reads', () => {
  it.each(Object.entries(APP_MODE_ACCENTS))(
    '%s accent (%s): picks the higher-contrast foreground',
    (_mode, accent) => {
      const rgb = parseHexRgb(accent);
      expect(rgb).not.toBeNull();
      const L_accent = relativeLuminance(rgb!);
      const L_dark = relativeLuminance(parseHexRgb(DARK_TEXT)!);
      const L_light = relativeLuminance(parseHexRgb(LIGHT_TEXT)!);
      const picked = getReadableText(accent);
      const pickedL = picked === DARK_TEXT ? L_dark : L_light;
      const otherL = picked === DARK_TEXT ? L_light : L_dark;
      expect(contrastRatio(L_accent, pickedL)).toBeGreaterThanOrEqual(
        contrastRatio(L_accent, otherL),
      );
    },
  );
});
