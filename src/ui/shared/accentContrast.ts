/**
 * accentContrast — pick readable foreground text for any accent.
 *
 * The workspace-accent system (plumbing cyan `#00e5ff`, roofing
 * orange `#ff9800`) currently hardcodes the active-tab text color
 * to `#0a0a0f` because both accents are bright enough that dark
 * text reads. That assumption is correct today and baked into
 * ModeTabs + InteractiveButton + the active sliding pill.
 *
 * But the assumption breaks the moment a third workspace enters
 * the picture with a darker accent (deep navy, forest green,
 * maroon) — dark-on-dark stops reading and we'd need to flip each
 * callsite to `#fff` by hand.
 *
 * This module is the future-proof shim. Given any accent hex,
 * `getReadableText(accent)` returns `#0a0a0f` or `#fff`, picking
 * whichever has higher WCAG 2.1 contrast against the accent.
 * Callers that today write `color: '#0a0a0f'` on an accent-backed
 * surface should migrate opportunistically to
 * `color: getReadableText(accent)` — no behaviour change for the
 * two current accents, automatic correctness for any future
 * accent, no luminance-threshold magic number to maintain.
 *
 * ─── Algorithm ────────────────────────────────────────────────
 *
 * Pure WCAG 2.1 relative-luminance contrast ratio:
 *
 *   L = 0.2126·R_lin + 0.7152·G_lin + 0.0722·B_lin
 *       (sRGB channels linearised through the WCAG piecewise curve)
 *
 *   ratio = (L_bright + 0.05) / (L_dark + 0.05)     ∈ [1, 21]
 *
 * We compute two ratios — dark-text-on-accent and light-text-on-
 * accent — and pick whichever is higher. Tied cases return
 * `DARK_TEXT` (matches the pre-migration default, so the shim
 * is a no-op on edge cases).
 *
 * Why not a luminance threshold like `L > 0.5`? Because the
 * break-even point for our specific dark (`#0a0a0f`, L≈0.003)
 * and light (`#fff`, L=1) foregrounds is L≈0.186, not 0.5.
 * Hardcoding a threshold would work but gets the math wrong for
 * any fg/bg pairing — e.g. a future light-grey "LIGHT_TEXT". The
 * ratio-pair comparison self-adapts.
 *
 * ─── Why not use CSS's `color-contrast()`? ────────────────────
 *
 * CSS `color-contrast()` ships behind a flag in most browsers as
 * of 2026 and doesn't exist in the inline `style={{ color: … }}`
 * prop world. We have inline styles everywhere. Doing this in
 * JavaScript keeps the decision co-located with the accent source.
 */

/** Text color used on BRIGHT accents (cyan, orange, yellow,
 *  light-green). The near-black that matches the rest of the
 *  app's dark-mode text style. */
export const DARK_TEXT = '#0a0a0f';

/** Text color used on DIM accents (navy, maroon, forest). White
 *  maximises contrast against anything below the break-even
 *  luminance for our chosen dark text. */
export const LIGHT_TEXT = '#ffffff';

/**
 * Parse a 3-or-6-digit hex color (with or without leading `#`) to
 * its RGB channel triplet in 0–255. Returns null if the input
 * isn't a valid hex — callers fall back to dark text in that case.
 *
 * Accepts:
 *   • `#RRGGBB`, `#rgb`, `RRGGBB`, `rgb`
 *   • Any ASCII-hex digits (case-insensitive)
 *
 * Rejects:
 *   • `rgb(0, 229, 255)` — named or functional CSS notation
 *   • 8-digit hex with alpha (`#00e5ff80`) — strip alpha at the
 *     callsite if you need luminance from a transparent accent
 */
export function parseHexRgb(hex: string): { r: number; g: number; b: number } | null {
  const s = hex.trim().replace(/^#/, '').toLowerCase();
  // Short form: #rgb expands to #rrggbb.
  let long: string;
  if (/^[0-9a-f]{3}$/.test(s)) {
    long = s[0]! + s[0]! + s[1]! + s[1]! + s[2]! + s[2]!;
  } else if (/^[0-9a-f]{6}$/.test(s)) {
    long = s;
  } else {
    return null;
  }
  const r = parseInt(long.slice(0, 2), 16);
  const g = parseInt(long.slice(2, 4), 16);
  const b = parseInt(long.slice(4, 6), 16);
  return { r, g, b };
}

/**
 * Compute the WCAG 2.1 relative luminance of an RGB triplet.
 *
 * Channels come in as 0–255. Output is 0 (black) to 1 (white).
 *
 * Pure function — no state, no DOM. Safe to call in tight loops;
 * cache at the callsite if you need to (two hex → luminance calls
 * per app lifecycle is cheap enough that caching is a premature
 * optimisation).
 */
export function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const lin = (c: number): number => {
    const s = c / 255;
    // sRGB piecewise curve. Below the knee is linear, above is
    // exponential with γ ≈ 2.4. Matches the WCAG formula exactly.
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = lin(rgb.r);
  const g = lin(rgb.g);
  const b = lin(rgb.b);
  // CIE Y coefficients — human-eye weighted contribution per
  // primary. Green dominates because the eye is most sensitive to
  // it; blue barely contributes because the eye is least
  // sensitive.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2.1 contrast ratio between two luminances.
 *
 * Returns a value in [1, 21]. WCAG AA requires ≥4.5 for normal
 * text, ≥3 for large text; WCAG AAA requires ≥7 and ≥4.5
 * respectively.
 *
 * Order-independent — pass the luminances in any order and the
 * ratio is correctly normalised with the brighter on top.
 */
export function contrastRatio(L1: number, L2: number): number {
  const bright = Math.max(L1, L2);
  const dark = Math.min(L1, L2);
  return (bright + 0.05) / (dark + 0.05);
}

// Precompute the foreground-text luminances once at module load.
// They never change — the constants are fixed. Avoids recomputing
// on every `getReadableText` call.
const L_DARK_TEXT = relativeLuminance({ r: 0x0a, g: 0x0a, b: 0x0f });
const L_LIGHT_TEXT = relativeLuminance({ r: 0xff, g: 0xff, b: 0xff }); // = 1

/**
 * Return the foreground text color (`#0a0a0f` or `#ffffff`) that
 * has the higher WCAG contrast ratio against the given accent.
 *
 * Invariants (enforced by tests):
 *   • `getReadableText('#00e5ff')` → `'#0a0a0f'` (cyan, dark wins
 *     ~14:1 vs ~1.5:1). Migration guarantee for plumbing.
 *   • `getReadableText('#ff9800')` → `'#0a0a0f'` (orange, dark
 *     wins ~9:1 vs ~2:1). Migration guarantee for roofing.
 *   • `getReadableText('#001a4f')` → `'#ffffff'` (deep navy, light
 *     wins — sample future accent).
 *   • Invalid hex → `'#0a0a0f'` (conservative default; matches the
 *     pre-migration hardcoded value so a typo never white-screens
 *     the UI; tests catch the error instead).
 */
export function getReadableText(accent: string): string {
  const rgb = parseHexRgb(accent);
  if (!rgb) return DARK_TEXT;
  const L_accent = relativeLuminance(rgb);
  const ratio_dark = contrastRatio(L_accent, L_DARK_TEXT);
  const ratio_light = contrastRatio(L_accent, L_LIGHT_TEXT);
  // Tie → DARK_TEXT wins (pre-migration default). Near-ties are
  // effectively impossible for our two fixed fg values — the
  // break-even is a single point in colour space.
  return ratio_dark >= ratio_light ? DARK_TEXT : LIGHT_TEXT;
}
