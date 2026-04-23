/**
 * angleSnap — Phase 14-bug-fix pass
 *
 * Snaps a proposed next-segment direction to the nearest LEGAL bend
 * angle relative to the previous segment. Legal bends per IPC / real
 * fitting catalogs: 0°, ±22.5°, ±45°, ±90°.
 *
 * "0°" = straight continuation (no fitting). "±90°" = standard elbow.
 * Anything else produces a bend the contractor can't actually build
 * with stock fittings — so the draw tool should refuse to create it.
 *
 * This module is pure. No React, no Zustand, no Three. Plain Vec3s.
 *
 * Draw planes:
 *   horizontal (XZ) → snap the XZ component; preserve Y
 *   vertical   (XY or ZY) → snap the vertical component; preserve the
 *                           horizontal axis (detected from prev direction)
 */

import type { Vec3 } from '@core/events';

/** Legal relative bend angles (degrees), symmetric around 0. */
export const LEGAL_RELATIVE_ANGLES_DEG: readonly number[] = [
  -90, -45, -22.5, 0, 22.5, 45, 90,
];

const LEGAL_RELATIVE_ANGLES_RAD: readonly number[] =
  LEGAL_RELATIVE_ANGLES_DEG.map((d) => (d * Math.PI) / 180);

// ── Helpers ───────────────────────────────────────────────────

function xzLen(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[2] * v[2]);
}

/** Normalize an angle into [-π, π]. */
function wrap(r: number): number {
  return Math.atan2(Math.sin(r), Math.cos(r));
}

function nearestLegal(relRad: number): number {
  let best = 0;
  let bestErr = Infinity;
  for (const leg of LEGAL_RELATIVE_ANGLES_RAD) {
    const err = Math.abs(wrap(relRad - leg));
    if (err < bestErr) { bestErr = err; best = leg; }
  }
  return best;
}

// ── Public API ────────────────────────────────────────────────

/**
 * Snap `raw` direction so its angle relative to `prev` in the XZ
 * plane lands on one of the legal relative angles. Preserves raw's
 * Y component (vertical delta is independent of horizontal bend).
 *
 * Magnitude in the XZ plane is preserved, so the user's intended
 * segment length is respected as much as the angle constraint allows.
 *
 * Inputs can be zero-length (no-op returns raw).
 */
export function snapDirectionXZ(prev: Vec3, raw: Vec3): Vec3 {
  const prevXZ = xzLen(prev);
  const rawXZ = xzLen(raw);
  if (prevXZ < 1e-6 || rawXZ < 1e-6) return raw;

  const prevAng = Math.atan2(prev[2], prev[0]);
  const rawAng = Math.atan2(raw[2], raw[0]);
  const rel = wrap(rawAng - prevAng);
  const snappedRel = nearestLegal(rel);
  const absAng = prevAng + snappedRel;

  return [
    rawXZ * Math.cos(absAng),
    raw[1],
    rawXZ * Math.sin(absAng),
  ];
}

/**
 * Returns the snapped candidate point: given the previous two points
 * (defining the prior segment) and a proposed third point, bend the
 * last edge to a legal angle while preserving the user's intended
 * segment length in the horizontal plane.
 */
export function constrainCandidateToLegalBend(
  prevPoint: Vec3,
  lastPoint: Vec3,
  candidate: Vec3,
): Vec3 {
  const prevDir: Vec3 = [
    lastPoint[0] - prevPoint[0],
    lastPoint[1] - prevPoint[1],
    lastPoint[2] - prevPoint[2],
  ];
  const rawDir: Vec3 = [
    candidate[0] - lastPoint[0],
    candidate[1] - lastPoint[1],
    candidate[2] - lastPoint[2],
  ];
  const snappedDir = snapDirectionXZ(prevDir, rawDir);
  return [
    lastPoint[0] + snappedDir[0],
    lastPoint[1] + snappedDir[1],
    lastPoint[2] + snappedDir[2],
  ];
}

/**
 * True when `material` is rigid (PVC / ABS / CPVC / copper / cast iron
 * / steel / ductile iron). Flexible materials (PEX) bend freely and
 * shouldn't be angle-constrained.
 */
export function materialRequiresLegalAngles(material: string): boolean {
  return material !== 'pex';
}

// ── Length quantization along a fixed direction ────────────────

/**
 * Snap the LENGTH of the candidate segment from `lastPoint` toward
 * `candidate` to the nearest multiple of `gridStep`, while keeping
 * the direction EXACTLY fixed. Minimum 1 grid step so zero-length
 * segments never happen (the caller already rejects near-duplicates
 * separately, but belt-and-suspenders).
 *
 * Why this exists: after `constrainCandidateToLegalBend` places a
 * candidate at a legal relative angle (say 22.5°), a naive
 * `snapToGrid(point, 0.5)` on the resulting (x, y, z) rarely
 * preserves the angle — the three axes round independently. Snapping
 * the LENGTH along the already-legal direction keeps the angle
 * exact and only quantizes "how far along this direction."
 *
 * Returns `lastPoint` unchanged if the input length is below grid
 * step (caller handles the "too short to commit" case separately).
 */
export function snapLengthOnDirection(
  lastPoint: Vec3,
  candidate: Vec3,
  gridStep: number,
): Vec3 {
  if (gridStep <= 0) return candidate;
  const dx = candidate[0] - lastPoint[0];
  const dy = candidate[1] - lastPoint[1];
  const dz = candidate[2] - lastPoint[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return lastPoint;
  const snappedLen = Math.max(gridStep, Math.round(len / gridStep) * gridStep);
  const k = snappedLen / len;
  return [
    lastPoint[0] + dx * k,
    lastPoint[1] + dy * k,
    lastPoint[2] + dz * k,
  ];
}

// ── Unified draw-constraint entry point ────────────────────────

export interface DrawConstraintContext {
  /** Prior committed points in the current draw. Empty for first click. */
  points: readonly Vec3[];
  /** Material the user currently has selected. */
  material: string;
  /** 'horizontal' vs 'vertical' draw plane flag from the interaction store. */
  drawPlane: 'horizontal' | 'vertical';
  /** Grid step in feet (e.g. 0.5 for half-foot snap). */
  gridStep: number;
}

/**
 * Apply ALL active draw constraints to a proposed world point.
 * Produces the same result the commit path (`addDrawPoint`) would
 * produce, so the live cursor preview can show the user exactly
 * where their next click would land — including bend-to-legal-angle
 * + rise-to-legal + length-quantize.
 *
 * Shared source of truth with the interaction store to avoid drift
 * between "where the cursor looks like it'll go" and "where the
 * point actually lands."
 *
 * PEX and the first point bypass the bend + rise constraints; they
 * still get grid-snap.
 */
export function applyDrawConstraints(
  raw: Vec3,
  ctx: DrawConstraintContext,
): Vec3 {
  const { points, material, drawPlane, gridStep } = ctx;

  if (points.length === 0 || !materialRequiresLegalAngles(material)) {
    return [
      Math.round(raw[0] / gridStep) * gridStep,
      Math.round(raw[1] / gridStep) * gridStep,
      Math.round(raw[2] / gridStep) * gridStep,
    ];
  }

  const last = points[points.length - 1]!;
  let c: Vec3 = raw;

  // XZ bend — only when we have a prior direction (≥ 2 points).
  if (points.length >= 2 && drawPlane === 'horizontal') {
    const prev = points[points.length - 2]!;
    c = constrainCandidateToLegalBend(prev, last, c);
  }

  // Vertical rise — always apply (0° / ±45° / ±90°).
  c = constrainRiseToLegal(last, c);

  // Length quantize along the now-legal direction.
  return snapLengthOnDirection(last, c, gridStep);
}

// ── Vertical-plane bend snapping ───────────────────────────────

/**
 * Legal RISE angles for vertical work, measured off the horizontal:
 *   0° (horizontal continuation) / ±45° / ±90° (vertical riser).
 *
 * 22.5° is intentionally NOT in this list — no stock DWV fitting
 * pairs a 22.5° vertical rise with a 22.5° horizontal run, and the
 * confusion cost outweighs the occasional need.
 */
export const LEGAL_VERTICAL_RISE_DEG: readonly number[] = [-90, -45, 0, 45, 90];

/**
 * Snap the candidate so the rise angle (asin(|dy| / length)) lands
 * on a legal vertical-plane angle relative to `lastPoint`. Preserves
 * the XZ heading chosen by the user — only the Y component is
 * adjusted to hit a legal rise.
 *
 * Note: this does NOT consider the XZ bend relative to the prior
 * segment — that's `constrainCandidateToLegalBend`'s job. Callers
 * in vertical draw mode that want BOTH constraints should call
 * `constrainCandidateToLegalBend` first (to fix XZ heading) then
 * `constrainRiseToLegal` (to fix vertical tilt).
 */
export function constrainRiseToLegal(lastPoint: Vec3, candidate: Vec3): Vec3 {
  const dx = candidate[0] - lastPoint[0];
  const dy = candidate[1] - lastPoint[1];
  const dz = candidate[2] - lastPoint[2];
  const horiz = Math.sqrt(dx * dx + dz * dz);
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return candidate;

  // Rise in radians from the horizontal plane. `dy > 0` rising.
  const rise = Math.atan2(dy, horiz);
  const legalRadList = LEGAL_VERTICAL_RISE_DEG.map((d) => (d * Math.PI) / 180);
  let bestErr = Infinity;
  let bestRise = 0;
  for (const leg of legalRadList) {
    const err = Math.abs(rise - leg);
    if (err < bestErr) { bestErr = err; bestRise = leg; }
  }

  // Rebuild the candidate at `len` but tilted to `bestRise`. Preserve
  // the XZ heading (cos θ, sin θ angle around Y) — only re-proportion
  // the horizontal vs vertical share of the total length.
  const newY = Math.sin(bestRise) * len;
  const newHoriz = Math.cos(bestRise) * len;
  // Guard divide-by-zero for vertical case (horiz → 0).
  if (horiz < 1e-6) {
    // User's raw was pure vertical; just snap to ±90° or 0°.
    return [lastPoint[0], lastPoint[1] + newY, lastPoint[2]];
  }
  const hx = dx / horiz;
  const hz = dz / horiz;
  return [
    lastPoint[0] + hx * newHoriz,
    lastPoint[1] + newY,
    lastPoint[2] + hz * newHoriz,
  ];
}
