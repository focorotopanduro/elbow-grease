/**
 * Path Smoother — reduces redundant waypoints from grid-based A*.
 *
 * Raw A* output on a voxel grid produces paths with a waypoint at
 * every cell crossing, even along straight runs. A 20-foot straight
 * pipe generates 40 waypoints at 0.5ft cells — wasteful for
 * TubeGeometry and fitting detection.
 *
 * Smoothing passes:
 *   1. Collinear merge — removes points along straight lines
 *   2. Redundant bend removal — if skipping a point doesn't hit
 *      an obstacle, remove it (line-of-sight check via SDF)
 *   3. Corner rounding — optional: adds slight offsets at 90° bends
 *      to produce smoother TubeGeometry curves
 */

import type { Vec3 } from '../events';
import type { SignedDistanceField } from './SignedDistanceField';

// ── Collinear point removal ─────────────────────────────────────

/**
 * Remove points that lie on a straight line between their neighbors.
 * A point B between A and C is collinear if the cross product
 * of (B-A) and (C-A) has near-zero magnitude.
 */
export function removeCollinear(path: Vec3[], tolerance: number = 0.01): Vec3[] {
  if (path.length <= 2) return [...path];

  const result: Vec3[] = [path[0]!];

  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1]!;
    const curr = path[i]!;
    const next = path[i + 1]!;

    // Vectors A→B and A→C
    const abx = curr[0] - prev[0], aby = curr[1] - prev[1], abz = curr[2] - prev[2];
    const acx = next[0] - prev[0], acy = next[1] - prev[1], acz = next[2] - prev[2];

    // Cross product magnitude
    const cx = aby * acz - abz * acy;
    const cy = abz * acx - abx * acz;
    const cz = abx * acy - aby * acx;
    const crossMag = Math.sqrt(cx * cx + cy * cy + cz * cz);

    if (crossMag > tolerance) {
      result.push(curr); // not collinear, keep it
    }
  }

  result.push(path[path.length - 1]!);
  return result;
}

// ── Line-of-sight smoothing ─────────────────────────────────────

/**
 * Remove waypoints where a direct line from the previous point
 * to the next point doesn't pass through obstacles.
 *
 * Uses SDF ray marching: walk along the line at half-cell intervals
 * and check if any sample is inside an obstacle.
 */
export function lineOfSightSmooth(path: Vec3[], sdf: SignedDistanceField): Vec3[] {
  if (path.length <= 2) return [...path];

  const cellSize = sdf.getCellSize();
  const stepSize = cellSize * 0.5;
  const result: Vec3[] = [path[0]!];

  let anchor = 0; // index of last committed point

  for (let probe = 2; probe < path.length; probe++) {
    const from = path[anchor]!;
    const to = path[probe]!;

    if (!hasLineOfSight(from, to, sdf, stepSize)) {
      // Can't skip — commit the point before the obstruction
      result.push(path[probe - 1]!);
      anchor = probe - 1;
    }
  }

  result.push(path[path.length - 1]!);
  return result;
}

function hasLineOfSight(
  from: Vec3, to: Vec3,
  sdf: SignedDistanceField,
  stepSize: number,
): boolean {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (dist < stepSize) return true;

  const steps = Math.ceil(dist / stepSize);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = from[0] + dx * t;
    const py = from[1] + dy * t;
    const pz = from[2] + dz * t;

    if (sdf.getDistanceAt([px, py, pz]) <= 0) return false;
  }

  return true;
}

// ── Corner rounding ─────────────────────────────────────────────

/**
 * At 90° bends, insert two additional points slightly offset to
 * create a smooth curve when rendered as TubeGeometry.
 *
 * Before: A → B → C  (hard 90° corner at B)
 * After:  A → B1 → B → B2 → C  (B1 and B2 are 0.3 cells from B)
 *
 * This makes pipes look like real pipes with radiused bends rather
 * than sharp grid corners.
 */
export function roundCorners(path: Vec3[], radius: number = 0.15): Vec3[] {
  if (path.length <= 2) return [...path];

  const result: Vec3[] = [path[0]!];

  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1]!;
    const curr = path[i]!;
    const next = path[i + 1]!;

    // Compute angle at this point
    const d1x = curr[0] - prev[0], d1y = curr[1] - prev[1], d1z = curr[2] - prev[2];
    const d2x = next[0] - curr[0], d2y = next[1] - curr[1], d2z = next[2] - curr[2];

    const len1 = Math.sqrt(d1x * d1x + d1y * d1y + d1z * d1z) || 1;
    const len2 = Math.sqrt(d2x * d2x + d2y * d2y + d2z * d2z) || 1;

    const dot = (d1x * d2x + d1y * d2y + d1z * d2z) / (len1 * len2);

    // Only round sharp bends (< 150°)
    if (dot > -0.5) {
      // Near-straight or obtuse — no rounding needed
      result.push(curr);
      continue;
    }

    // Insert pre-corner point (approaching from prev direction)
    const r = Math.min(radius, len1 * 0.4, len2 * 0.4);
    const preX = curr[0] - (d1x / len1) * r;
    const preY = curr[1] - (d1y / len1) * r;
    const preZ = curr[2] - (d1z / len1) * r;
    result.push([preX, preY, preZ]);

    // Keep the corner point
    result.push(curr);

    // Insert post-corner point (departing toward next direction)
    const postX = curr[0] + (d2x / len2) * r;
    const postY = curr[1] + (d2y / len2) * r;
    const postZ = curr[2] + (d2z / len2) * r;
    result.push([postX, postY, postZ]);
  }

  result.push(path[path.length - 1]!);
  return result;
}

// ── Full smoothing pipeline ─────────────────────────────────────

/**
 * Apply all smoothing passes in sequence.
 * Input: raw A* waypoints (one per grid cell).
 * Output: clean path with minimal points and smooth corners.
 */
export function smoothPath(
  rawPath: Vec3[],
  sdf: SignedDistanceField,
  cornerRadius: number = 0.15,
): Vec3[] {
  if (rawPath.length <= 2) return rawPath;

  // Pass 1: Remove collinear points (straight runs → 2 endpoints)
  let path = removeCollinear(rawPath);

  // Pass 2: Line-of-sight skip (remove unnecessary waypoints)
  path = lineOfSightSmooth(path, sdf);

  // Pass 3: Round sharp corners for smooth TubeGeometry
  path = roundCorners(path, cornerRadius);

  return path;
}
