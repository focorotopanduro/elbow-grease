/**
 * groupRotation — Phase 14.M
 *
 * Pure math for rotating a multi-entity selection around its centroid
 * in the XZ plane (around world Y). Used by:
 *
 *   • Bracket-key rotation shortcuts when multi-select ≥ 2
 *   • The group rotation gizmo (drag-to-rotate around centroid)
 *
 * Design contract: for each entity in the selection,
 *   new position = R_y(deltaDeg) · (position − centroid) + centroid
 * Pipes also have their polyline points transformed this way. Fixture
 * rotationDeg accumulates the delta so the fixture's own orientation
 * tracks the group rotation (a toilet that was facing east before a
 * 90° CCW group rotation now faces north).
 *
 * No React / Zustand / Three.js. Plain Vec3 in, plain Vec3 out.
 */

import type { Vec3 } from '@core/events';

// ── Types ─────────────────────────────────────────────────────

export interface RotatablePipe {
  id: string;
  points: readonly Vec3[];
}

export interface RotatableFixture {
  id: string;
  position: Vec3;
  /** Current rotationDeg in degrees (world Y rotation). */
  rotationDeg: number;
}

export interface GroupRotationInput {
  pipes: readonly RotatablePipe[];
  fixtures: readonly RotatableFixture[];
}

export interface GroupRotationResult {
  pipes: Array<{ id: string; points: Vec3[] }>;
  fixtures: Array<{ id: string; position: Vec3; rotationDeg: number }>;
}

// ── Centroid ──────────────────────────────────────────────────

/**
 * Arithmetic mean of every pipe point + every fixture position.
 * Returns [0, 0, 0] for an empty selection so callers don't have to
 * null-check. Y is the average Y across the selection — rotating in
 * XZ keeps everyone at their existing height but the centroid's Y
 * is used for the gizmo's render height.
 */
export function computeGroupCentroid(
  pipes: readonly RotatablePipe[],
  fixtures: readonly RotatableFixture[],
): Vec3 {
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const p of pipes) {
    for (const pt of p.points) {
      sx += pt[0]; sy += pt[1]; sz += pt[2]; n++;
    }
  }
  for (const f of fixtures) {
    sx += f.position[0]; sy += f.position[1]; sz += f.position[2]; n++;
  }
  if (n === 0) return [0, 0, 0];
  return [sx / n, sy / n, sz / n];
}

// ── Rotation ──────────────────────────────────────────────────

/** Rotate `pt` around `center` in XZ by `deltaDeg` (Y unchanged). */
export function rotatePointAroundCenter(pt: Vec3, center: Vec3, deltaDeg: number): Vec3 {
  const rad = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = pt[0] - center[0];
  const dz = pt[2] - center[2];
  // Positive deltaDeg in our XZ convention (atan2(dz, dx)) rotates
  // CCW when viewed from +Y looking down. Matches the single-fixture
  // gizmo's rotation direction (14.F).
  return [
    center[0] + dx * cos - dz * sin,
    pt[1], // Y unchanged — we rotate around world Y
    center[2] + dx * sin + dz * cos,
  ];
}

/**
 * Normalize to [0, 360). `((x % 360) + 360) % 360` avoids `-0`.
 * Duplicated from rotationGizmoMath so this module is standalone.
 */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Transform every pipe point + every fixture position by rotating
 * `deltaDeg` around `center`. Fixture `rotationDeg` also absorbs the
 * delta so each fixture's orientation tracks the group — without
 * this, a row of east-facing toilets would STAY east-facing even
 * after rotating the group 90°, which feels broken.
 */
export function rotateGroupAroundY(
  input: GroupRotationInput,
  center: Vec3,
  deltaDeg: number,
): GroupRotationResult {
  const pipes = input.pipes.map((p) => ({
    id: p.id,
    points: p.points.map((pt) => rotatePointAroundCenter(pt, center, deltaDeg)),
  }));
  const fixtures = input.fixtures.map((f) => ({
    id: f.id,
    position: rotatePointAroundCenter(f.position, center, deltaDeg),
    rotationDeg: normalizeDeg(f.rotationDeg + deltaDeg),
  }));
  return { pipes, fixtures };
}
