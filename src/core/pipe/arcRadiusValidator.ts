/**
 * arcRadiusValidator — Phase 14.V
 *
 * Closes the "multi-vertex tight arc" gap in PEX bend validation.
 *
 * Background (Phase 14.U): `classifyBend` inspects the DEFLECTION
 * ANGLE at a vertex to decide "smooth vs. elbow vs. kink." That
 * works for sharp single-vertex kinks but misses cumulative
 * tight-arc cases where the user draws a pseudo-curve as ten short
 * segments, each bending 18°. Every individual vertex classifies as
 * `smooth_bend` → no warning → the pipe ships with geometry that
 * physically would kink.
 *
 * Key insight: the real spec is **radius of curvature**, not
 * deflection angle. A 30° deflection over 10-ft legs gives a ~19 ft
 * radius (fine for every PEX size). The SAME 30° deflection over
 * 1-ft legs gives a ~1.9 ft radius (still fine for 3/4"), but over
 * 0.3-ft legs gives ~0.56 ft — tight for 2" PEX whose minimum is
 * 1.06 ft.
 *
 * This module computes the local bend radius at each internal
 * vertex using the leg-length + deflection geometry, and compares
 * to `minBendRadiusFt` from `PipeSizeSpec`. Pure math — no Three,
 * no React, no Zustand. Fully testable.
 */

import type { Vec3 } from '@core/events';
import type { PipeMaterial } from '../../engine/graph/GraphEdge';
import { isFlexibleMaterial, minBendRadiusFt } from './PipeSizeSpec';

// ── Helpers ───────────────────────────────────────────────────

function distance(a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Absolute deflection angle (degrees) at vertex b between edges
 * a→b and b→c. Straight = 0; reversal = 180.
 */
export function deflectionDegAt(a: Vec3, b: Vec3, c: Vec3): number {
  const ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2];
  const bx = c[0] - b[0], by = c[1] - b[1], bz = c[2] - b[2];
  const la = Math.sqrt(ax * ax + ay * ay + az * az);
  const lb = Math.sqrt(bx * bx + by * by + bz * bz);
  if (la < 1e-9 || lb < 1e-9) return 0;
  const dot = (ax * bx + ay * by + az * bz) / (la * lb);
  const clamped = Math.max(-1, Math.min(1, dot));
  return (Math.acos(clamped) * 180) / Math.PI;
}

// ── Local bend radius ─────────────────────────────────────────

/**
 * Approximate the centerline radius of curvature at vertex `b`
 * assuming a circular arc tangent to both legs (a→b and b→c).
 *
 *   R ≈ (min(|ab|,|bc|) / 2) / tan(deflection / 2)
 *
 * Why half the shorter leg: we need the arc's setback distance from
 * b to stay inside BOTH legs. If the setback went past the midpoint
 * of either leg, arcs from adjacent vertices would overlap. Using
 * half the shorter leg is the conservative "maximum radius this
 * geometry supports" estimate.
 *
 * Returns `Infinity` for straight-through (deflection ≈ 0) — there's
 * no bend, so no radius constraint applies.
 */
export function localBendRadiusFt(a: Vec3, b: Vec3, c: Vec3): number {
  const leg1 = distance(a, b);
  const leg2 = distance(b, c);
  const halfShortLeg = Math.min(leg1, leg2) / 2;
  const deflDeg = deflectionDegAt(a, b, c);
  if (deflDeg < 0.1) return Infinity; // essentially straight
  const deflRad = (deflDeg * Math.PI) / 180;
  // tan(deflection/2) — for 180° reversal this is Infinity, yielding
  // radius 0 (a hard kink, as expected).
  const halfAngleTan = Math.tan(deflRad / 2);
  if (halfAngleTan < 1e-9) return Infinity;
  return halfShortLeg / halfAngleTan;
}

// ── Violation records ─────────────────────────────────────────

export interface ArcViolation {
  /** Index in the points array where the violation occurs. */
  vertexIndex: number;
  /** Estimated local bend radius at this vertex, in feet. */
  radiusFt: number;
  /** Minimum legal radius for the pipe's material + diameter, in feet. */
  minRadiusFt: number;
  /** World-space position of the violating vertex. */
  position: Vec3;
  /** Deflection angle at the violation, in degrees. */
  deflectionDeg: number;
  /**
   * Ratio `radius / minRadius`. Always < 1 for violations. Callers
   * use this to color-severity (< 0.5 = critical kink, 0.5–1 =
   * marginal).
   */
  severity: number;
}

/**
 * Walk a PEX / flexible polyline and report every vertex whose
 * local bend radius is below the material's minimum.
 *
 * Rigid materials bypass — they use fittings, not bends, so there
 * IS no radius constraint to violate. Returns `[]` for rigid input.
 *
 * Returns empty for < 3 points (no interior vertex to test).
 */
export function validateArcRadii(
  points: readonly Vec3[],
  material: PipeMaterial,
  diameterIn: number,
): ArcViolation[] {
  if (!isFlexibleMaterial(material)) return [];
  if (points.length < 3) return [];
  const minR = minBendRadiusFt(material, diameterIn);
  if (minR === null) return [];

  const out: ArcViolation[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    const R = localBendRadiusFt(a, b, c);
    if (R < minR) {
      out.push({
        vertexIndex: i,
        radiusFt: R,
        minRadiusFt: minR,
        position: [b[0], b[1], b[2]],
        deflectionDeg: deflectionDegAt(a, b, c),
        severity: R / minR,
      });
    }
  }
  return out;
}

/**
 * Convenience predicate: is this polyline route kink-free for the
 * given PEX material + diameter? Used by the live-draw validator to
 * color the rubber-band red vs. green before the user commits.
 */
export function isArcRadiusLegal(
  points: readonly Vec3[],
  material: PipeMaterial,
  diameterIn: number,
): boolean {
  return validateArcRadii(points, material, diameterIn).length === 0;
}
