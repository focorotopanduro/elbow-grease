/**
 * pipeCollision — Phase 14.X
 *
 * Detects pipe-pipe geometry overlaps across already-committed pipes
 * in the scene. Sibling of `CollisionPredictor.ts` which handles
 * pipe-vs-structure during route preview; this module handles the
 * "two pipes already in the scene occupy the same space" case that
 * can cause z-fighting, visual tearing, and confusion in the BOM.
 *
 * Design:
 *
 *   • Segment-pair distance check between every pair of pipes.
 *   • Shared endpoints (legal T-junctions, crosses, couplings) are
 *     EXCLUDED — they're junctions, not collisions.
 *   • Near-parallel coincident runs are flagged because they visually
 *     overlap even though they share no endpoint.
 *   • O(P²) in pipe count; fine for typical scenes (≤ 500 pipes).
 *     For bigger scenes a spatial index would help — not needed yet.
 *
 * Output: a list of `PipeCollision` records with enough info for the
 * visualizer to place a marker and for a future auto-resolver to
 * know WHICH pipe to jog.
 *
 * Pure module — no React, no Zustand, no Three. Tests drive the
 * math directly.
 */

import type { Vec3 } from '@core/events';
import type { CommittedPipe } from '../../store/pipeStore';
import { JUNCTION_TOLERANCE_FT } from '../pipe/junctionConstants';

// ── Types ─────────────────────────────────────────────────────

export type PipeCollisionSeverity = 'clip' | 'overlap' | 'touch';

export interface PipeCollision {
  /** Pipe A id. */
  pipeA: string;
  /** Pipe B id. */
  pipeB: string;
  /** Segment index within pipe A (edges between points[i] and points[i+1]). */
  segmentA: number;
  /** Segment index within pipe B. */
  segmentB: number;
  /** Approximate world-space collision location (midpoint of closest approach). */
  position: Vec3;
  /** Minimum distance between the two segment axes, in feet. */
  minDistance: number;
  /** Required clearance for these pipes (outer radii + 1" buffer), in feet. */
  requiredClearance: number;
  /**
   * How hard the collision is:
   *   'clip'    — segment axes within the combined-radii distance
   *               (the tubes literally intersect; 3D render will z-fight)
   *   'overlap' — within half the required clearance (close enough
   *               to visually read as overlapping)
   *   'touch'   — within full required clearance but > overlap
   *               (warning only)
   */
  severity: PipeCollisionSeverity;
}

// ── Geometry helpers ──────────────────────────────────────────

function distanceSq(a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Minimum distance between two 3D line segments + the two closest
 * points on each. Classic closest-point-between-two-segments algorithm,
 * adapted from Real-Time Collision Detection (Ericson, ch. 5).
 *
 * Returns:
 *   distance    — minimum separation, in same units as input
 *   closestA    — point on segment A closest to segment B
 *   closestB    — point on segment B closest to segment A
 */
export function closestPointsOnSegments(
  a1: Vec3, a2: Vec3,
  b1: Vec3, b2: Vec3,
): { distance: number; closestA: Vec3; closestB: Vec3 } {
  const EPS = 1e-9;
  const d1: Vec3 = [a2[0] - a1[0], a2[1] - a1[1], a2[2] - a1[2]];
  const d2: Vec3 = [b2[0] - b1[0], b2[1] - b1[1], b2[2] - b1[2]];
  const r: Vec3  = [a1[0] - b1[0], a1[1] - b1[1], a1[2] - b1[2]];
  const a = d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2];
  const e = d2[0] * d2[0] + d2[1] * d2[1] + d2[2] * d2[2];
  const f = d2[0] * r[0]  + d2[1] * r[1]  + d2[2] * r[2];

  let s: number;
  let t: number;

  if (a <= EPS && e <= EPS) {
    // Both segments degenerate to points
    s = 0; t = 0;
  } else if (a <= EPS) {
    // A is a point
    s = 0;
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2];
    if (e <= EPS) {
      // B is a point
      t = 0;
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
      const denom = a * e - b * b;
      if (denom !== 0) {
        s = Math.max(0, Math.min(1, (b * f - c * e) / denom));
      } else {
        s = 0;
      }
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }

  const closestA: Vec3 = [a1[0] + d1[0] * s, a1[1] + d1[1] * s, a1[2] + d1[2] * s];
  const closestB: Vec3 = [b1[0] + d2[0] * t, b1[1] + d2[1] * t, b1[2] + d2[2] * t];
  const distance = Math.sqrt(distanceSq(closestA, closestB));
  return { distance, closestA, closestB };
}

// ── Shared-endpoint detection (legal junctions) ───────────────

// Phase 14.AD.14 — single source via junctionConstants.
const JUNCTION_TOL = JUNCTION_TOLERANCE_FT;

function pointsClose(a: Vec3, b: Vec3): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return dx * dx + dy * dy + dz * dz < JUNCTION_TOL * JUNCTION_TOL;
}

/**
 * Legal junction detection: two segments share an endpoint if any
 * of their 4 ends are within JUNCTION_TOL of each other.
 */
function segmentsShareEndpoint(
  a1: Vec3, a2: Vec3,
  b1: Vec3, b2: Vec3,
): boolean {
  return pointsClose(a1, b1) || pointsClose(a1, b2)
      || pointsClose(a2, b1) || pointsClose(a2, b2);
}

/**
 * Phase 14.AD.20 — is one segment's endpoint INTERIOR to the other
 * segment (a legal mid-pipe branch T-junction)?
 *
 * Case the classic `segmentsShareEndpoint` misses: pipe A runs
 * (0,0,0)→(10,0,0) as a single segment, pipe B starts at (5,0,0)
 * and branches off. Pipe B's endpoint lies ON pipe A's segment but
 * not at either of pipe A's vertices. The generator now emits a
 * proper tee/wye/combo there; the collision detector must mirror
 * that treatment and skip the "CLIP" warning.
 *
 * Returns true iff:
 *   • b1 (or b2) projects INTERIOR to segment a1-a2 (projection
 *     parameter strictly in (0, 1) after clamping for robustness)
 *     AND is within JUNCTION_TOLERANCE_FT perpendicular distance
 *     of the segment centerline,
 *   • OR the symmetric case with a's endpoint interior to b.
 */
function segmentsShareJunction(
  a1: Vec3, a2: Vec3,
  b1: Vec3, b2: Vec3,
): boolean {
  if (segmentsShareEndpoint(a1, a2, b1, b2)) return true;

  const tol2 = JUNCTION_TOLERANCE_FT * JUNCTION_TOLERANCE_FT;
  const endpointOnSegment = (p: Vec3, s0: Vec3, s1: Vec3): boolean => {
    const sx = s1[0] - s0[0];
    const sy = s1[1] - s0[1];
    const sz = s1[2] - s0[2];
    const segLen2 = sx * sx + sy * sy + sz * sz;
    if (segLen2 < 1e-8) return false;
    const ex = p[0] - s0[0];
    const ey = p[1] - s0[1];
    const ez = p[2] - s0[2];
    const t = (ex * sx + ey * sy + ez * sz) / segLen2;
    // Strictly interior — endpoints were already handled above.
    if (t < 0.02 || t > 0.98) return false;
    const cx = s0[0] + sx * t;
    const cy = s0[1] + sy * t;
    const cz = s0[2] + sz * t;
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const dz = p[2] - cz;
    return dx * dx + dy * dy + dz * dz <= tol2;
  };

  return endpointOnSegment(b1, a1, a2)
      || endpointOnSegment(b2, a1, a2)
      || endpointOnSegment(a1, b1, b2)
      || endpointOnSegment(a2, b1, b2);
}

// ── Main detector ──────────────────────────────────────────────

export interface DetectOptions {
  /** Extra buffer beyond radii+OD for "touch" threshold. Default 1". */
  extraBufferFt?: number;
}

/**
 * Scan every pair of pipes in the scene for overlapping segments.
 * Excludes legal junctions (shared endpoints).
 *
 * Complexity: O(P² × S²) where P = pipes, S = avg segments per pipe.
 * For typical scenes (P ≤ 500, S ≤ 10) this is 25M comparisons
 * worst-case — each comparison is ~10 flops — still sub-500ms.
 * Good enough for now; spatial index can come later.
 */
export function detectPipePipeCollisions(
  pipes: readonly CommittedPipe[],
  options: DetectOptions = {},
): PipeCollision[] {
  const out: PipeCollision[] = [];
  const bufFt = options.extraBufferFt ?? 1 / 12;

  for (let i = 0; i < pipes.length; i++) {
    const a = pipes[i]!;
    // Pipe-radius includes the diameter tube, which is what visually
    // renders in the scene. For the overlap check we test the
    // centerlines + compare to the sum of radii.
    const radiusA = a.diameter / 24; // inches → feet
    if (!a.visible) continue;

    for (let j = i + 1; j < pipes.length; j++) {
      const b = pipes[j]!;
      if (!b.visible) continue;
      const radiusB = b.diameter / 24;
      const required = radiusA + radiusB + bufFt;

      for (let sa = 0; sa < a.points.length - 1; sa++) {
        const a1 = a.points[sa]!;
        const a2 = a.points[sa + 1]!;

        for (let sb = 0; sb < b.points.length - 1; sb++) {
          const b1 = b.points[sb]!;
          const b2 = b.points[sb + 1]!;

          // Skip legal junctions — shared endpoint (a tee / coupling
          // / elbow) or a mid-segment branch (AD.20) where one pipe
          // starts from the centerline of another. The fitting
          // generator's mid-segment detection emits the proper
          // tee/wye/combo there, so a collision at that exact spot
          // is spurious.
          if (segmentsShareJunction(a1, a2, b1, b2)) continue;

          const { distance, closestA, closestB } = closestPointsOnSegments(
            a1, a2, b1, b2,
          );
          if (distance >= required) continue;

          const severity: PipeCollisionSeverity =
            distance < radiusA + radiusB ? 'clip'
            : distance < required * 0.5 ? 'overlap'
            : 'touch';

          out.push({
            pipeA: a.id,
            pipeB: b.id,
            segmentA: sa,
            segmentB: sb,
            position: [
              (closestA[0] + closestB[0]) / 2,
              (closestA[1] + closestB[1]) / 2,
              (closestA[2] + closestB[2]) / 2,
            ],
            minDistance: distance,
            requiredClearance: required,
            severity,
          });
        }
      }
    }
  }
  return out;
}

/**
 * Summary stats for a scene. Cheap way to show a "5 collisions
 * detected" counter in the compliance panel without re-enumerating
 * the full list.
 */
export interface PipeCollisionSummary {
  total: number;
  clip: number;
  overlap: number;
  touch: number;
}

export function summarizePipeCollisions(
  collisions: readonly PipeCollision[],
): PipeCollisionSummary {
  const out: PipeCollisionSummary = { total: collisions.length, clip: 0, overlap: 0, touch: 0 };
  for (const c of collisions) out[c.severity]++;
  return out;
}
