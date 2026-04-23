/**
 * pointsKey — stable value hash for a Vec3-like polyline.
 *
 * Problem it solves: React `useMemo([points, radius], …)` fires when
 * `points` changes IDENTITY, not VALUE. Several places in the pipe
 * preview regenerate `Vec3[]` arrays from live math every frame
 * (pivot session, live route math) — the array contents are identical
 * but the reference is new, so `useMemo` rebuilds TubeGeometry /
 * CatmullRomCurve3 60 times a second for no visual change.
 *
 * `pointsKey(points)` returns a short string that is:
 *
 *   • byte-for-byte equal when two arrays contain the same coordinates
 *     (to 1e-4 — a tenth of a millimetre in plumbing units, well below
 *     the minPointDistance snap of 0.3 units used by routing);
 *   • different when any coordinate differs by more than the tolerance,
 *     or when the number of points differs.
 *
 * Use as a useMemo dep:
 *
 *     const key = pointsKey(points);
 *     const geometry = useMemo(buildGeometry, [key, radius]);
 *
 * Precision rationale: building stringified JSON of raw floats produces
 * a fresh string every frame even for unchanged geometry due to the
 * non-deterministic way floating-point math accumulates rounding during
 * the caller's regeneration. Rounding to 4 decimal places (≈ 0.0001
 * feet = ~0.03 mm) is precise enough that a real drag will always cross
 * it, but noise from regeneration will not.
 */

export type Vec3Tuple = readonly [number, number, number];

const PRECISION = 1e4; // 4 decimal places

/** Round n to the configured precision; preserves -0 as 0. */
function roundCoord(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * PRECISION) / PRECISION;
}

/**
 * Build a stable value-hash for a polyline. Output format is compact:
 *
 *   "N:x0,y0,z0|x1,y1,z1|…"
 *
 * Leading N is the point count so degenerate cases (0 or 1 point) still
 * produce unique keys and a 2-point line can't alias a 3-point line
 * that happens to share the first two coords.
 */
export function pointsKey(points: readonly Vec3Tuple[] | undefined | null): string {
  if (!points || points.length === 0) return '0:';
  let s = points.length + ':';
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (i > 0) s += '|';
    s += roundCoord(p[0]) + ',' + roundCoord(p[1]) + ',' + roundCoord(p[2]);
  }
  return s;
}
