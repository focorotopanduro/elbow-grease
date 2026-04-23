/**
 * PexBendClassifier — decides how a corner in a PEX (or generally
 * flexible) pipe route should be rendered and, if applicable, what
 * fitting to place.
 *
 * The user's ask, distilled:
 *
 *   "uponor must behave organically by uniting and reconciling pipes
 *    which are drawn in 45 degree turns. when drawn in 90 degree turns
 *    then put a 90 degree fitting there instead of a bend, otherwise
 *    smooth out the edges... uponor doesn't generate 90s unless
 *    specifically asked for."
 *
 * This module is the rule engine for that decision. The output is one of:
 *
 *   'fitting_90'     — corner within ±FITTING_90_TOLERANCE_DEG of 90°;
 *                      render with a PEX 90° fitting (the user
 *                      explicitly asked for it by drawing a right angle).
 *
 *   'smooth_bend'    — corner in a "gentle bend" range (roughly 30°-60°
 *                      and 120°-150°). PEX's bend radius handles this
 *                      physically; render as one continuous tube with
 *                      a smoothed vertex.
 *
 *   'smooth_curve'   — very slight deviation (< 15° off-straight). Treat
 *                      as straight-ish; still smooth, no fitting.
 *
 *   'sharp_bend'     — corner too tight for PEX's 8×D minimum bend
 *                      radius. Warn: either add a 90° fitting or
 *                      reroute. The extender UI prevents these.
 *
 * For rigid materials (PVC, copper, cast iron) the classifier falls
 * back to fitting-based output since those can't physically bend.
 *
 * This is a PURE function — no imports, no state, fully unit-testable.
 */

import type { PipeMaterial } from '../../engine/graph/GraphEdge';

// ── Constants ──────────────────────────────────────────────────

/** Tolerance (degrees) for "this counts as a right-angle corner". */
export const FITTING_90_TOLERANCE_DEG = 7;

/** Below this deflection, treat the vertex as "barely curved — just smooth it". */
export const SMOOTH_CURVE_THRESHOLD_DEG = 15;

/**
 * Minimum PEX bend radius: ≥ 8× outer diameter per ASTM F876/877.
 * Below this radius (= above this deflection angle at the segment
 * lengths involved), the pipe kinks.
 *
 * Heuristic used here: deflection > 120° on short segments is
 * considered sharp. The extender UI respects the actual geometry.
 */
export const SHARP_BEND_DEFLECTION_DEG = 120;

/**
 * Materials that physically CAN bend. PEX is the extreme case; CPVC
 * doesn't qualify (it's rigid), despite being a flexible family.
 */
const FLEXIBLE_MATERIALS = new Set<PipeMaterial>(['pex']);

// ── Types ──────────────────────────────────────────────────────

export type BendKind =
  | 'fitting_90'
  | 'smooth_bend'
  | 'smooth_curve'
  | 'sharp_bend'
  /** Rigid material → every non-straight vertex uses a fitting. */
  | 'fitting_other';

export interface BendClassification {
  kind: BendKind;
  /** Absolute deflection from straight, in degrees. Straight=0°, U-turn=180°. */
  deflectionDeg: number;
  /**
   * For 'fitting_90' and 'fitting_other', the fitting angle in
   * degrees we'd specify on the fitting catalog: 90, 45, 22.5, or
   * a custom value rounded to the nearest standard.
   */
  standardFittingAngleDeg?: 90 | 45 | 22.5 | 'custom';
}

// ── Deflection calculator ──────────────────────────────────────

/**
 * Compute the deflection angle at a vertex given the two adjacent
 * segment directions. Returns degrees in [0, 180].
 *
 *   deflection = 180° - interior_angle
 *
 * A straight run has deflection 0; a U-turn (reversal) has deflection 180.
 */
export function deflectionDeg(
  incoming: [number, number, number],
  outgoing: [number, number, number],
): number {
  const [ix, iy, iz] = normalizeIn(incoming);
  const [ox, oy, oz] = normalizeIn(outgoing);
  // Dot product of the outgoing vs. the CONTINUATION direction.
  // If segments go in-and-out-straight, dot(incoming, outgoing) = 1 → 0° deflection.
  const dot = ix * ox + iy * oy + iz * oz;
  // Clamp for numeric safety
  const clamped = Math.max(-1, Math.min(1, dot));
  const interiorRad = Math.acos(clamped);
  // Deflection is the SUPPLEMENT of the interior angle between the
  // vectors: if both point in the same direction, dot=1 → acos=0 →
  // deflection=0. If they oppose, dot=-1 → acos=π → deflection=180.
  const interiorDeg = (interiorRad * 180) / Math.PI;
  return interiorDeg;
}

function normalizeIn(v: [number, number, number]): [number, number, number] {
  const [x, y, z] = v;
  const len = Math.hypot(x, y, z);
  if (len === 0) return [0, 0, 0];
  return [x / len, y / len, z / len];
}

// ── Main classifier ───────────────────────────────────────────

/**
 * Classify a single bend. Inputs:
 *   - Two adjacent segment direction vectors (outgoing from the
 *     previous segment, and outgoing into the next segment).
 *   - Pipe material.
 */
export function classifyBend(
  incomingDir: [number, number, number],
  outgoingDir: [number, number, number],
  material: PipeMaterial,
): BendClassification {
  const d = deflectionDeg(incomingDir, outgoingDir);
  const standardAngle = snapToStandardFittingAngle(d);
  const isFlex = FLEXIBLE_MATERIALS.has(material);

  if (isFlex) {
    // PEX rules.
    if (d < SMOOTH_CURVE_THRESHOLD_DEG) {
      return { kind: 'smooth_curve', deflectionDeg: d };
    }
    if (Math.abs(d - 90) <= FITTING_90_TOLERANCE_DEG) {
      // User drew a right angle → honor it with a 90° fitting, matching
      // QuickPlumb's behavior.
      return { kind: 'fitting_90', deflectionDeg: d, standardFittingAngleDeg: 90 };
    }
    if (d > SHARP_BEND_DEFLECTION_DEG) {
      return { kind: 'sharp_bend', deflectionDeg: d };
    }
    // Everything else is smoothed into the tube. 45° falls here
    // exactly as the user described.
    return { kind: 'smooth_bend', deflectionDeg: d };
  }

  // Rigid materials — every vertex uses a fitting.
  if (d < SMOOTH_CURVE_THRESHOLD_DEG) {
    return { kind: 'smooth_curve', deflectionDeg: d };
  }
  return { kind: 'fitting_other', deflectionDeg: d, standardFittingAngleDeg: standardAngle };
}

// ── Standard fitting angle snap ───────────────────────────────

/**
 * Snap an arbitrary deflection to the nearest standard plumbing
 * fitting angle (22.5°, 45°, 90°). Returns 'custom' if none fits
 * within ±FITTING_90_TOLERANCE_DEG.
 */
export function snapToStandardFittingAngle(
  deflectionDeg: number,
): 90 | 45 | 22.5 | 'custom' {
  const candidates = [
    { angle: 90 as const, d: Math.abs(deflectionDeg - 90) },
    { angle: 45 as const, d: Math.abs(deflectionDeg - 45) },
    { angle: 22.5 as const, d: Math.abs(deflectionDeg - 22.5) },
  ].sort((a, b) => a.d - b.d);

  const best = candidates[0]!;
  if (best.d <= FITTING_90_TOLERANCE_DEG) return best.angle;
  return 'custom';
}

// ── Path-level helper: classify every interior vertex of a route ──

/**
 * Walk a polyline (N ≥ 2 points) and classify every interior vertex.
 * Returns an array of length N-2 (no classification for endpoints).
 *
 * Useful for: deciding on render time whether to subdivide the tube
 * path with fittings vs. smooth the vertex with a Catmull-Rom segment.
 */
export function classifyRoute(
  points: Array<[number, number, number]>,
  material: PipeMaterial,
): BendClassification[] {
  const out: BendClassification[] = [];
  if (points.length < 3) return out;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const next = points[i + 1]!;
    const incoming: [number, number, number] = [
      cur[0] - prev[0],
      cur[1] - prev[1],
      cur[2] - prev[2],
    ];
    const outgoing: [number, number, number] = [
      next[0] - cur[0],
      next[1] - cur[1],
      next[2] - cur[2],
    ];
    out.push(classifyBend(incoming, outgoing, material));
  }
  return out;
}
