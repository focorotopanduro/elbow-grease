/**
 * PivotController — mathematical engine for constrained pipe pivoting.
 *
 * When the user grabs one endpoint of a pipe (via the edge hitbox)
 * and drags, this module computes:
 *
 *   1. The signed angle delta between the original direction and the
 *      current mouse direction (both measured from the opposite anchor)
 *   2. The nearest LEGAL angle: {0, ±22.5°, ±45°, ±90°} — matching
 *      manufactured fittings (1/16, 1/8, 1/4 bends)
 *   3. Whether the raw angle is within snap tolerance of a legal value
 *   4. The rotated pipe geometry after applying the snapped delta
 *
 * The rotation is applied around the anchor endpoint, so the anchor
 * stays perfectly fixed and ALL other points (including intermediate
 * bend waypoints) rotate rigidly — preserving the pipe's shape.
 *
 * The snap works on the XZ plane for horizontal rotations (top view)
 * and XY for vertical rotations (when drawing on a wall plane).
 *
 * Why this matters — real plumbing can only turn at these fittings.
 * Snap-back protocol: if the user releases the drag at a non-legal
 * angle, the pipe reverts to its original position with a "cancel"
 * sound. This prevents the user from accidentally drawing non-
 * realizable geometry.
 */

import type { Vec3 } from '../events';

// ── Legal relative angles (radians) ─────────────────────────────

/**
 * Every standard plumbing bend translates to one of these relative
 * rotation deltas (positive = CCW, negative = CW).
 */
export const LEGAL_PIVOT_DELTAS_RAD: number[] = [
  -Math.PI / 2,   // -90° (CW quarter turn)
  -Math.PI / 4,   // -45° (CW 1/8 bend)
  -Math.PI / 8,   // -22.5° (CW 1/16 bend)
  0,              // no change (straight)
  Math.PI / 8,    // +22.5°
  Math.PI / 4,    // +45°
  Math.PI / 2,    // +90°
];

/** Maximum error (radians) to still count as "snapped." */
export const DEFAULT_SNAP_TOL_RAD = Math.PI / 45; // 4°

// ── Computation types ──────────────────────────────────────────

export type PivotPlane = 'xz' | 'xy';

export interface PivotDelta {
  /** Raw angular delta from original direction (radians, signed). */
  rawAngle: number;
  /** Nearest legal angle (radians). */
  snappedAngle: number;
  /** Abs error between raw and snapped (radians). */
  error: number;
  /** True if within snap tolerance — commit would be accepted. */
  isLegal: boolean;
  /** Human-readable fitting name (e.g. "1/4 bend (90°)"). */
  fittingName: string;
}

// ── Core computation ───────────────────────────────────────────

/**
 * Compute the angular delta between an original direction and the
 * current mouse position, both measured from a shared anchor.
 */
export function computePivotDelta(
  anchor: Vec3,
  originalGrabbedPos: Vec3,
  currentMousePos: Vec3,
  plane: PivotPlane = 'xz',
  tolerance: number = DEFAULT_SNAP_TOL_RAD,
): PivotDelta {
  // Extract planar components
  const [ox, oy] = planarComponents(
    [
      originalGrabbedPos[0] - anchor[0],
      originalGrabbedPos[1] - anchor[1],
      originalGrabbedPos[2] - anchor[2],
    ],
    plane,
  );
  const [mx, my] = planarComponents(
    [
      currentMousePos[0] - anchor[0],
      currentMousePos[1] - anchor[1],
      currentMousePos[2] - anchor[2],
    ],
    plane,
  );

  // atan2 gives us absolute angles in the plane
  const origAngle = Math.atan2(oy, ox);
  const newAngle = Math.atan2(my, mx);

  // Signed delta, normalized to [-π, π]
  let delta = newAngle - origAngle;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;

  // Find nearest legal angle
  let bestSnap = 0;
  let bestError = Infinity;
  for (const legal of LEGAL_PIVOT_DELTAS_RAD) {
    const err = Math.abs(delta - legal);
    if (err < bestError) {
      bestError = err;
      bestSnap = legal;
    }
  }

  const isLegal = bestError < tolerance;
  const fittingName = describeAngle(bestSnap);

  return {
    rawAngle: delta,
    snappedAngle: bestSnap,
    error: bestError,
    isLegal,
    fittingName,
  };
}

// ── Apply rotation to pipe points ──────────────────────────────

/**
 * Rotate every point around the anchor by the given delta angle.
 * Points at the anchor position stay fixed. Other points orbit.
 */
export function applyPivot(
  originalPoints: Vec3[],
  anchor: Vec3,
  deltaAngle: number,
  plane: PivotPlane = 'xz',
): Vec3[] {
  const c = Math.cos(deltaAngle);
  const s = Math.sin(deltaAngle);

  return originalPoints.map((p) => {
    const dx = p[0] - anchor[0];
    const dy = p[1] - anchor[1];
    const dz = p[2] - anchor[2];

    if (plane === 'xz') {
      const rx = dx * c - dz * s;
      const rz = dx * s + dz * c;
      return [anchor[0] + rx, p[1], anchor[2] + rz] as Vec3;
    }
    // xy plane
    const rx = dx * c - dy * s;
    const ry = dx * s + dy * c;
    return [anchor[0] + rx, anchor[1] + ry, p[2]] as Vec3;
  });
}

// ── Helpers ────────────────────────────────────────────────────

function planarComponents(v: Vec3, plane: PivotPlane): [number, number] {
  return plane === 'xz' ? [v[0], v[2]] : [v[0], v[1]];
}

function describeAngle(angleRad: number): string {
  const deg = (angleRad * 180) / Math.PI;
  const abs = Math.abs(deg);
  const sign = deg < 0 ? '−' : deg > 0 ? '+' : '';
  if (abs < 0.1) return 'Straight (0°)';
  if (Math.abs(abs - 22.5) < 0.1) return `${sign}1/16 bend (22.5°)`;
  if (Math.abs(abs - 45) < 0.1)   return `${sign}1/8 bend (45°)`;
  if (Math.abs(abs - 90) < 0.1)   return `${sign}1/4 bend (90°)`;
  return `${sign}${abs.toFixed(1)}°`;
}

// ── Distance-from-anchor helpers (used for length preservation) ─

/** Distance in the pivot plane between two points. */
export function planarDistance(a: Vec3, b: Vec3, plane: PivotPlane): number {
  if (plane === 'xz') {
    const dx = b[0] - a[0], dz = b[2] - a[2];
    return Math.sqrt(dx * dx + dz * dz);
  }
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

// ── Preview line for legal positions ───────────────────────────

/**
 * Generate the positions the grabbed endpoint would occupy at each
 * legal angle. Used by PivotPreview to render "snap guide" rays
 * emanating from the anchor.
 */
export function computeLegalPositions(
  anchor: Vec3,
  grabbedOrig: Vec3,
  plane: PivotPlane = 'xz',
): { angle: number; pos: Vec3; fittingName: string }[] {
  return LEGAL_PIVOT_DELTAS_RAD.map((angle) => {
    const rotated = applyPivot([grabbedOrig], anchor, angle, plane)[0]!;
    return {
      angle,
      pos: rotated,
      fittingName: describeAngle(angle),
    };
  });
}
