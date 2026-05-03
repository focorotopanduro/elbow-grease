/**
 * Shared color helpers for scene components.
 *
 * Kept tiny on purpose — only the math the SVG layers need. Anything richer
 * (palette tokens, named theme colors) belongs in a real design-token module.
 */

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Linear interpolate between two RGB triplets, returning a CSS rgb() string.
 * Used by every scene module to drift toward storm colors as wind rises.
 *
 *   lerpRgb([255,0,0], [0,0,255], 0)    // 'rgb(255, 0, 0)'
 *   lerpRgb([255,0,0], [0,0,255], 0.5)  // 'rgb(128, 0, 128)'
 *   lerpRgb([255,0,0], [0,0,255], 1)    // 'rgb(0, 0, 255)'
 */
export const lerpRgb = (
  a: [number, number, number],
  b: [number, number, number],
  t: number
): string =>
  `rgb(${Math.round(lerp(a[0], b[0], t))}, ${Math.round(lerp(a[1], b[1], t))}, ${Math.round(lerp(a[2], b[2], t))})`;
