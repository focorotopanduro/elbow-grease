/**
 * polylineMath — cheap 3D polyline geometry helpers.
 *
 * Currently one function: given a pipe's point array and a world-space
 * hit point, find the nearest segment and the projection parameter
 * `t` in [0, 1] along it. Used by Phase 7.A (tee-from-middle-drag)
 * and a sensible home for future polyline helpers (projection onto
 * the pipe as a whole, arc-length parameterization, etc.).
 *
 * No dependencies.
 */

import type { Vec3 } from '@core/events';

export interface NearestOnPolyline {
  /** Index of the segment: the segment runs from points[idx] to points[idx+1]. */
  segmentIdx: number;
  /** Parameter in [0, 1] along that segment. */
  t: number;
  /** World-space projection of the hit onto the segment. */
  worldPoint: Vec3;
  /** Squared Euclidean distance from `hit` to `worldPoint` (skipping the sqrt). */
  distSq: number;
}

/**
 * Return the closest point on any segment of `points` to `hit`, plus
 * the owning segment index and parameterization.
 *
 * Returns null if the polyline is degenerate (< 2 points or all
 * segments zero-length).
 */
export function nearestSegmentOnPolyline(
  points: readonly Vec3[],
  hit: Vec3,
): NearestOnPolyline | null {
  if (points.length < 2) return null;

  let best: NearestOnPolyline | null = null;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const segLenSq = abx * abx + aby * aby + abz * abz;
    if (segLenSq < 1e-6) continue; // zero-length segment

    const apx = hit[0] - a[0], apy = hit[1] - a[1], apz = hit[2] - a[2];
    const tRaw = (apx * abx + apy * aby + apz * abz) / segLenSq;
    const t = Math.max(0, Math.min(1, tRaw));

    const px = a[0] + abx * t;
    const py = a[1] + aby * t;
    const pz = a[2] + abz * t;
    const dx = hit[0] - px, dy = hit[1] - py, dz = hit[2] - pz;
    const distSq = dx * dx + dy * dy + dz * dz;

    if (!best || distSq < best.distSq) {
      best = { segmentIdx: i, t, worldPoint: [px, py, pz], distSq };
    }
  }

  return best;
}
