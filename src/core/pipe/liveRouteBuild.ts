/**
 * liveRouteBuild — Phase 14.Q
 *
 * Pure math for the live draw preview. Three concerns:
 *
 *   1. Turn a polyline into a list of straight segments + the per-
 *      segment geometry a tube renderer needs (length, center,
 *      quaternion-like basis). Straight tubes, never splined — a
 *      plumber drawing a waste run expects sharp elbows, not a
 *      cubic-interpolated noodle.
 *
 *   2. Compute slope (drop in inches per foot) per segment so the
 *      UI can show the real pitch while the user draws. Matches the
 *      committed PitchIndicators.tsx formula.
 *
 *   3. Classify the draw direction so the UI can tell the user
 *      "you're at 2°, snap to 22.5°" during the drag. Complements
 *      angleSnap.ts (which enforces the snap) by exposing the raw
 *      measurement for display.
 *
 * Zero Three.js / Zustand / React. All operations are pure — points
 * in, plain records out. Tested in isolation.
 */

import type { Vec3 } from '@core/events';

// ── Basic vector ops (kept local; no external lib dependency) ──

export function distance(a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Horizontal-plane distance (XZ only). Used for slope denominator. */
export function horizontalDistance(a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dz * dz);
}

// ── Segment records ───────────────────────────────────────────

export interface RouteSegment {
  a: Vec3;
  b: Vec3;
  /** Straight-line length (ft). */
  length: number;
  /**
   * Midpoint world coord. Used to place cylinder center, pitch
   * labels, and fitting previews.
   */
  mid: Vec3;
  /**
   * Slope magnitude in inches per foot (|dy| / horiz * 12). Matches
   * IPC convention. 0 for perfectly horizontal, ∞ for fully vertical
   * (we cap at "vertical" flag instead — see `isVertical`).
   */
  slopeInchesPerFoot: number;
  /**
   * True when the segment is essentially vertical (horizontal run ≈ 0).
   * Slope-per-foot is meaningless for verticals; callers should
   * render a "VERT" indicator instead.
   */
  isVertical: boolean;
  /**
   * Unit direction from a → b. Pre-computed once so callers don't
   * re-normalize in render loops.
   */
  direction: Vec3;
}

/**
 * Break a polyline into segments with pre-computed geometry. Skips
 * zero-length segments (duplicate points that can occur when the
 * user double-clicks the same grid cell). Returns [] when the input
 * has < 2 points.
 */
export function buildRouteSegments(points: readonly Vec3[]): RouteSegment[] {
  if (points.length < 2) return [];
  const out: RouteSegment[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = distance(a, b);
    if (len < 1e-6) continue;

    const horiz = horizontalDistance(a, b);
    const dy = b[1] - a[1];
    const isVertical = horiz < 1e-3;
    const slope = isVertical ? 0 : (Math.abs(dy) / horiz) * 12;

    const invLen = 1 / len;
    out.push({
      a: [a[0], a[1], a[2]],
      b: [b[0], b[1], b[2]],
      length: len,
      mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
      slopeInchesPerFoot: slope,
      isVertical,
      direction: [(b[0] - a[0]) * invLen, (b[1] - a[1]) * invLen, (b[2] - a[2]) * invLen],
    });
  }
  return out;
}

// ── Slope classification (matches committed PitchIndicators) ───

/**
 * IPC 704.1 minimum horizontal slopes for DWV (inches-per-foot):
 *   pipe ≤ 2.5"  →  1/4  (0.25)
 *   pipe 3–6"    →  1/8  (0.125)
 *   pipe ≥ 8"    →  1/16 (0.0625)
 *
 * Returns the required slope for a given diameter.
 */
export function requiredSlopeForDiameter(diameterIn: number): number {
  if (diameterIn <= 2.5) return 0.25;
  if (diameterIn <= 6) return 0.125;
  return 0.0625;
}

export type SlopeVerdict = 'compliant' | 'marginal' | 'undershot' | 'flat';

/**
 * Compare a measured slope to the code minimum for the pipe's
 * diameter. Matches the color scale used in committed PitchIndicators:
 *
 *   compliant  — slope ≥ required          → green
 *   marginal   — required/2 ≤ slope < req  → amber
 *   undershot  — 0.01 ≤ slope < required/2 → red
 *   flat       — slope < 0.01              → no label
 *
 * `flat` is deliberately NOT the same as "needs slope" — a vertical
 * riser reports `flat` (no horizontal run to slope across) and is
 * fine. Callers should check `segment.isVertical` to disambiguate.
 */
export function classifySlope(
  slopeInchesPerFoot: number,
  diameterIn: number,
): SlopeVerdict {
  if (slopeInchesPerFoot < 0.01) return 'flat';
  const required = requiredSlopeForDiameter(diameterIn);
  if (slopeInchesPerFoot >= required) return 'compliant';
  if (slopeInchesPerFoot >= required / 2) return 'marginal';
  return 'undershot';
}

// ── Bend angle at internal vertices ────────────────────────────

/**
 * For each internal vertex (not the endpoints), return the absolute
 * bend angle in degrees between the incoming and outgoing directions.
 * Used for the live fitting preview + the "you're at 47° — snap to
 * 45°" hint.
 *
 * Returns one entry per internal vertex, in the same order as
 * `points.slice(1, -1)`. Empty result for < 3 points.
 */
export function bendAnglesDeg(points: readonly Vec3[]): number[] {
  if (points.length < 3) return [];
  const out: number[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const next = points[i + 1]!;
    const ax = cur[0] - prev[0], ay = cur[1] - prev[1], az = cur[2] - prev[2];
    const bx = next[0] - cur[0], by = next[1] - cur[1], bz = next[2] - cur[2];
    const la = Math.sqrt(ax * ax + ay * ay + az * az);
    const lb = Math.sqrt(bx * bx + by * by + bz * bz);
    if (la < 1e-6 || lb < 1e-6) { out.push(0); continue; }
    const dot = (ax * bx + ay * by + az * bz) / (la * lb);
    // Clamp for floating-point noise near ±1
    const c = Math.max(-1, Math.min(1, dot));
    const rad = Math.acos(c);
    out.push((rad * 180) / Math.PI);
  }
  return out;
}

// ── Total length ──────────────────────────────────────────────

export function totalLength(points: readonly Vec3[]): number {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += distance(points[i - 1]!, points[i]!);
  return s;
}
