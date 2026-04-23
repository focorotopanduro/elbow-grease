/**
 * pipeDirections — Phase 14.AD.30.
 *
 * CANONICAL direction + angle helpers for pipe geometry. Before this
 * module, every subsystem that needed to know "which way does pipe
 * A go at the junction?" re-derived the same math with subtly
 * different sign conventions:
 *
 *   • FittingGenerator: `directionVector(from, to)` — travel
 *     direction, points FROM→TO
 *   • segmentExtractCache: inline subtraction + normalize, travel
 *     direction
 *   • PipeRenderer.junctionMap (pre-extract): inline, OUTWARD
 *     direction (endpoint → pipe body)
 *   • junctionRetraction: inline, OUTWARD direction
 *   • OrthoPipeInteraction: inline, OUTWARD direction for session
 *
 * The sign-convention inconsistency between "travel" and "outward"
 * is the exact shape of bug that caused AD.19 (bend quaternion
 * rotated the elbow onto the wrong axis) and AD.24 (tee quaternion
 * mapped the main cylinder along the branch direction). Having ONE
 * module with clearly-labeled helpers for each semantic meaning
 * makes those bugs impossible to write accidentally.
 *
 * All helpers here:
 *   • Return NORMALIZED direction vectors (or zero-length fallback
 *     for degenerate input — never NaN).
 *   • Never throw. Pipes with invalid data report a stable default.
 *   • Pure. No React, no Zustand, no Three. Input is Vec3 tuples,
 *     output is Vec3 tuples. Three.Vector3 callers can wrap.
 *
 * Semantic glossary:
 *
 *   TRAVEL direction
 *     Direction water/flow travels along a pipe segment. For a
 *     segment from A to B, travel direction is normalize(B - A).
 *     Used for flow analysis, slope computation.
 *
 *   OUTWARD direction at endpoint
 *     Direction pointing FROM the endpoint INTO the pipe's body
 *     (toward the adjacent interior point). Used for junction
 *     angle measurement and for knowing "where does this pipe's
 *     tube extend from the junction?". For the START endpoint,
 *     outward = normalize(points[1] - points[0]); for the END
 *     endpoint, outward = normalize(points[last-1] - points[last]).
 *
 *   IN-JUNCTION direction
 *     Direction from a pipe body TOWARD a junction point. Equal
 *     to -OUTWARD at that endpoint.
 *
 *   SEGMENT TANGENT
 *     Unit direction along a segment, same as TRAVEL.
 *
 * The word "direction" without a qualifier in callers is
 * ambiguous — prefer the specific helper names in this module.
 */

import type { Vec3 } from '@core/events';

// ── Constants ────────────────────────────────────────────────────

/** Fallback returned when the requested direction is degenerate. */
export const ZERO_DIR: Vec3 = [0, 0, 0];

/** Default "up" for fallback bases (THREE.js world-up). */
export const WORLD_UP: Vec3 = [0, 1, 0];

const EPS = 1e-8;

// ── Core vector math ─────────────────────────────────────────────

export function vec3(x: number, y: number, z: number): Vec3 {
  return [x, y, z];
}

export function length(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

export function lengthSq(v: Vec3): number {
  return v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
}

export function normalize(v: Vec3): Vec3 {
  const len = length(v);
  if (len < EPS) return ZERO_DIR;
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale(v: Vec3, k: number): Vec3 {
  return [v[0] * k, v[1] * k, v[2] * k];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Euclidean distance between two points. */
export function distance(a: Vec3, b: Vec3): number {
  return length(sub(b, a));
}

// ── Pipe-semantic direction helpers ──────────────────────────────

/**
 * Unit tangent direction along a segment from `from` to `to`.
 * Equal to "travel direction". Returns ZERO_DIR if the segment is
 * degenerate (points coincide within EPS).
 */
export function segmentTangent(from: Vec3, to: Vec3): Vec3 {
  return normalize(sub(to, from));
}

/**
 * Outward direction at the pipe's START endpoint — points FROM the
 * start point INTO the pipe body (toward points[1]). Returns
 * ZERO_DIR for pipes with < 2 points or coincident first two points.
 */
export function outwardStart(points: readonly Vec3[]): Vec3 {
  if (points.length < 2) return ZERO_DIR;
  return segmentTangent(points[0]!, points[1]!);
}

/**
 * Outward direction at the pipe's END endpoint — points FROM the
 * end point INTO the pipe body (toward points[last-1]). Returns
 * ZERO_DIR for pipes with < 2 points or coincident last two points.
 */
export function outwardEnd(points: readonly Vec3[]): Vec3 {
  if (points.length < 2) return ZERO_DIR;
  const last = points.length - 1;
  return segmentTangent(points[last]!, points[last - 1]!);
}

/**
 * The pipe's travel direction ENTERING its end endpoint (last
 * segment direction, start → end of that segment). Equivalent to
 * -outwardEnd.
 */
export function travelIntoEnd(points: readonly Vec3[]): Vec3 {
  if (points.length < 2) return ZERO_DIR;
  const last = points.length - 1;
  return segmentTangent(points[last - 1]!, points[last]!);
}

/**
 * Travel direction LEAVING the pipe's start endpoint (first
 * segment direction). Equivalent to outwardStart.
 */
export function travelOutOfStart(points: readonly Vec3[]): Vec3 {
  return outwardStart(points);
}

// ── Angle computations ──────────────────────────────────────────

/**
 * Angle in DEGREES between two unit direction vectors (0..180).
 * Returns 0 for degenerate input (either vector zero-length).
 */
export function angleBetweenDeg(a: Vec3, b: Vec3): number {
  if (lengthSq(a) < EPS || lengthSq(b) < EPS) return 0;
  const d = Math.max(-1, Math.min(1, dot(normalize(a), normalize(b))));
  return (Math.acos(d) * 180) / Math.PI;
}

/**
 * BEND angle at a polyline vertex — the deflection angle measured
 * from "would have continued straight" to "actually bends to".
 * For straight runs returns 0. For a 90° corner returns 90.
 *
 * Computed as angleBetween(prevDir, nextDir) where prevDir and
 * nextDir are both TRAVEL directions — i.e., both point along
 * water flow. For a straight pipe both are equal → angle 0. For a
 * 90° turn they're perpendicular → angle 90.
 */
export function bendAngleAtVertex(
  prev: Vec3,
  vertex: Vec3,
  next: Vec3,
): number {
  const prevDir = segmentTangent(prev, vertex);
  const nextDir = segmentTangent(vertex, next);
  return angleBetweenDeg(prevDir, nextDir);
}

/**
 * Branch angle between two pipes meeting at a junction, measured
 * between their TRAVEL directions (both pointing INTO the junction
 * from their respective approaches). Returns 0..180 degrees.
 *
 * For a perpendicular tee: 90°. For a Y-junction with two arms
 * meeting at 45° off a trunk: 45° between the arms (if the two
 * pipes are the two arms) OR 135° between one arm and the trunk.
 */
export function branchAngleDeg(
  pipeA_approach: Vec3,
  pipeB_approach: Vec3,
): number {
  return angleBetweenDeg(pipeA_approach, pipeB_approach);
}

// ── Orientation classification ──────────────────────────────────

export type Orientation = 'horizontal' | 'vertical' | 'oblique';

/**
 * Classify a unit direction vector as predominantly horizontal,
 * vertical, or oblique. Y is the vertical axis (THREE.js world
 * convention). Uses a 0.7 cutoff (≈45° off-vertical) — a direction
 * that's more vertical than 45° from horizontal is 'vertical'.
 */
export function classifyOrientation(dir: Vec3): Orientation {
  const y = Math.abs(dir[1]);
  if (y >= 0.7) return 'vertical';
  if (y <= 0.3) return 'horizontal';
  return 'oblique';
}

// ── Gram-Schmidt perpendicular (Phase 14.AD.24 tee basis) ────────

/**
 * Component of `v` perpendicular to `axis`. Returns a unit vector
 * in the plane perpendicular to `axis` that points along v's
 * in-plane component. For v parallel to axis, returns a sensible
 * fallback perpendicular (WORLD_UP or WORLD_X).
 */
export function perpendicularTo(v: Vec3, axis: Vec3): Vec3 {
  const a = normalize(axis);
  if (lengthSq(a) < EPS) return normalize(v);
  const vn = normalize(v);
  const d = dot(vn, a);
  const perp: Vec3 = [
    vn[0] - a[0] * d,
    vn[1] - a[1] * d,
    vn[2] - a[2] * d,
  ];
  if (lengthSq(perp) < EPS) {
    // v is parallel to axis — return a fallback perpendicular.
    // Prefer world UP; if axis is parallel to UP, use world +X.
    const fallback: Vec3 = Math.abs(a[1]) < 0.95 ? WORLD_UP : [1, 0, 0];
    return perpendicularTo(fallback, axis);
  }
  return normalize(perp);
}

// ── Endpoint-proximity utilities ─────────────────────────────────

/** Squared-distance threshold for "near a position" checks. */
export function isNear(a: Vec3, b: Vec3, tolerance: number): boolean {
  return lengthSq(sub(a, b)) <= tolerance * tolerance;
}

/**
 * Which endpoint of `points` is nearest to `pos`, if any, within
 * tolerance. Returns `null` if neither endpoint is close.
 */
export function nearestEndpoint(
  points: readonly Vec3[],
  pos: Vec3,
  tolerance: number,
): 'start' | 'end' | null {
  if (points.length < 2) return null;
  const dStart = lengthSq(sub(points[0]!, pos));
  const dEnd = lengthSq(sub(points[points.length - 1]!, pos));
  const tol2 = tolerance * tolerance;
  if (dStart <= tol2 && dStart <= dEnd) return 'start';
  if (dEnd <= tol2) return 'end';
  return null;
}
