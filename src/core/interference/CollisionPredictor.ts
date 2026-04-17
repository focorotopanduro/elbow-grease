/**
 * Collision Predictor — real-time sweep test on route preview.
 *
 * Runs BEFORE the pipe is committed to predict clashes along the
 * proposed route. This gives the user immediate visual feedback
 * during manual drawing and auto-routing:
 *
 *   GREEN path segments  → clear, no interference
 *   YELLOW segments      → within clearance zone (warning)
 *   RED segments         → collision with structural element
 *
 * Uses cylinder-box sweep tests for speed (not full SDF lookup).
 * Target: < 1ms for a 50-waypoint route against 100 elements.
 */

import type { Vec3 } from '../events';
import {
  type StructuralElement,
  type StructuralType,
  CLEARANCE_RULES,
} from './StructuralElements';
import type { CommittedPipe } from '../../store/pipeStore';

// ── Collision result ────────────────────────────────────────────

export type SegmentStatus = 'clear' | 'warning' | 'collision';

export interface SegmentCollision {
  /** Index of the segment (between points[i] and points[i+1]). */
  segmentIndex: number;
  status: SegmentStatus;
  /** Midpoint of the segment (for visual marker placement). */
  midpoint: Vec3;
  /** Which element is being clashed with (null if pipe-pipe). */
  elementId: string | null;
  elementType: StructuralType | null;
  /** Distance to nearest obstacle surface (feet). */
  clearance: number;
  /** Required clearance (feet). */
  requiredClearance: number;
}

export interface CollisionPrediction {
  /** Per-segment status. */
  segments: SegmentCollision[];
  /** Total collision count. */
  collisions: number;
  /** Total warning count. */
  warnings: number;
  /** Is the overall route clear? */
  routeClear: boolean;
  /** Prediction time in microseconds. */
  predictUs: number;
}

// ── Sweep test helpers ──────────────────────────────────────────

/**
 * Cylinder-AABB intersection test.
 * Tests if a cylinder (pipe segment) from point A to point B with
 * radius R intersects an axis-aligned bounding box.
 *
 * Simplified: samples N points along the segment and checks
 * point-to-box distance against radius + clearance.
 */
function segmentToBoxClearance(
  a: Vec3, b: Vec3,
  pipeRadius: number,
  boxMin: Vec3, boxMax: Vec3,
  samples: number = 5,
): number {
  let minDist = Infinity;

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const px = a[0] + (b[0] - a[0]) * t;
    const py = a[1] + (b[1] - a[1]) * t;
    const pz = a[2] + (b[2] - a[2]) * t;

    // Point-to-AABB distance
    const dx = Math.max(boxMin[0] - px, 0, px - boxMax[0]);
    const dy = Math.max(boxMin[1] - py, 0, py - boxMax[1]);
    const dz = Math.max(boxMin[2] - pz, 0, pz - boxMax[2]);
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) - pipeRadius;

    minDist = Math.min(minDist, dist);
  }

  return minDist;
}

/**
 * Segment-to-segment minimum distance (for pipe-pipe checks).
 */
function segmentToSegmentDist(
  a1: Vec3, a2: Vec3,
  b1: Vec3, b2: Vec3,
): number {
  // Simplified: sample both segments and find minimum point-to-point distance
  let minDist = Infinity;
  const stepsA = 4, stepsB = 4;

  for (let i = 0; i <= stepsA; i++) {
    const ta = i / stepsA;
    const px = a1[0] + (a2[0] - a1[0]) * ta;
    const py = a1[1] + (a2[1] - a1[1]) * ta;
    const pz = a1[2] + (a2[2] - a1[2]) * ta;

    for (let j = 0; j <= stepsB; j++) {
      const tb = j / stepsB;
      const qx = b1[0] + (b2[0] - b1[0]) * tb;
      const qy = b1[1] + (b2[1] - b1[1]) * tb;
      const qz = b1[2] + (b2[2] - b1[2]) * tb;

      const dx = px - qx, dy = py - qy, dz = pz - qz;
      minDist = Math.min(minDist, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
  }

  return minDist;
}

// ── Main predictor ──────────────────────────────────────────────

/**
 * Predict collisions for a proposed route.
 *
 * @param points — route waypoints
 * @param pipeDiameter — pipe diameter in inches
 * @param elements — structural elements in the building
 * @param existingPipes — already committed pipes (for pipe-pipe checks)
 */
export function predictCollisions(
  points: Vec3[],
  pipeDiameter: number,
  elements: StructuralElement[],
  existingPipes: CommittedPipe[] = [],
): CollisionPrediction {
  const t0 = performance.now();
  const pipeRadius = pipeDiameter / 24; // inches → feet
  const segments: SegmentCollision[] = [];
  let collisions = 0;
  let warnings = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const ptA = points[i]!;
    const ptB = points[i + 1]!;
    const mid: Vec3 = [
      (ptA[0] + ptB[0]) / 2,
      (ptA[1] + ptB[1]) / 2,
      (ptA[2] + ptB[2]) / 2,
    ];

    let worstStatus: SegmentStatus = 'clear';
    let worstClearance = Infinity;
    let worstElementId: string | null = null;
    let worstElementType: StructuralType | null = null;
    let worstRequired = 0;

    // Check against structural elements
    for (const elem of elements) {
      const rule = CLEARANCE_RULES[elem.type];
      const reqClearance = elem.clearanceOverride ?? rule.minClearance;

      const clearance = segmentToBoxClearance(
        ptA, ptB, pipeRadius,
        elem.min, elem.max,
      );

      if (clearance < worstClearance) {
        worstClearance = clearance;
        worstRequired = reqClearance;
        worstElementId = elem.id;
        worstElementType = elem.type;

        if (clearance < 0) {
          worstStatus = 'collision';
        } else if (clearance < reqClearance) {
          worstStatus = worstStatus === 'collision' ? 'collision' : 'warning';
        }
      }
    }

    // Check against existing pipes
    for (const other of existingPipes) {
      const otherRadius = other.diameter / 24;
      const minSep = pipeRadius + otherRadius + 1 / 12; // 1" clearance

      for (let j = 0; j < other.points.length - 1; j++) {
        const dist = segmentToSegmentDist(
          ptA, ptB,
          other.points[j]!, other.points[j + 1]!,
        );

        if (dist < minSep && dist < worstClearance) {
          worstClearance = dist;
          worstRequired = minSep;
          worstElementId = other.id;
          worstElementType = null;

          if (dist < minSep * 0.3) {
            worstStatus = 'collision';
          } else if (dist < minSep) {
            worstStatus = worstStatus === 'collision' ? 'collision' : 'warning';
          }
        }
      }
    }

    if (worstStatus === 'collision') collisions++;
    if (worstStatus === 'warning') warnings++;

    segments.push({
      segmentIndex: i,
      status: worstStatus,
      midpoint: mid,
      elementId: worstElementId,
      elementType: worstElementType,
      clearance: worstClearance,
      requiredClearance: worstRequired,
    });
  }

  return {
    segments,
    collisions,
    warnings,
    routeClear: collisions === 0,
    predictUs: (performance.now() - t0) * 1000,
  };
}
