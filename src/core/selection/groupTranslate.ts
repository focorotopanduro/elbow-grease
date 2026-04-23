/**
 * groupTranslate — Phase 14.O
 *
 * Pure math for shifting a multi-entity selection by a delta vector.
 * Simpler than 14.M's rotation: each pipe point + fixture position
 * just gets `+ delta` added to it. Y is included in the delta so
 * callers can do XZ-only moves (dy = 0) OR vertical moves (dy ≠ 0)
 * with the same function.
 *
 * Drag session carries the starting centroid so the caller can
 * compute a live delta between cursor frames + optionally constrain
 * to an axis or snap to a grid before applying.
 *
 * No React / Zustand / Three. Plain Vec3 in, plain Vec3 out.
 */

import type { Vec3 } from '@core/events';

// ── Types ─────────────────────────────────────────────────────

export interface TranslatablePipe {
  id: string;
  points: readonly Vec3[];
}

export interface TranslatableFixture {
  id: string;
  position: Vec3;
}

export interface GroupTranslateInput {
  pipes: readonly TranslatablePipe[];
  fixtures: readonly TranslatableFixture[];
}

export interface GroupTranslateResult {
  pipes: Array<{ id: string; points: Vec3[] }>;
  fixtures: Array<{ id: string; position: Vec3 }>;
}

// ── Apply delta ──────────────────────────────────────────────

export function translateVec(v: Vec3, delta: Vec3): Vec3 {
  return [v[0] + delta[0], v[1] + delta[1], v[2] + delta[2]];
}

export function translateGroup(
  input: GroupTranslateInput,
  delta: Vec3,
): GroupTranslateResult {
  return {
    pipes: input.pipes.map((p) => ({
      id: p.id,
      points: p.points.map((pt) => translateVec(pt, delta)),
    })),
    fixtures: input.fixtures.map((f) => ({
      id: f.id,
      position: translateVec(f.position, delta),
    })),
  };
}

// ── Axis constraint (Shift held during drag) ────────────────

/**
 * Given a raw XZ drag delta, return a version clamped to the dominant
 * axis (whichever of |dx|, |dz| is larger). Used for "drag along X or
 * Z with a straight constraint" when Shift is held.
 */
export function constrainToDominantAxis(delta: Vec3): Vec3 {
  const adx = Math.abs(delta[0]);
  const adz = Math.abs(delta[2]);
  if (adx >= adz) return [delta[0], delta[1], 0];
  return [0, delta[1], delta[2]];
}

// ── Grid snap (Ctrl held during drag) ───────────────────────

/**
 * Snap a delta to the nearest multiple of `step` on X and Z. Y is
 * preserved (vertical snapping belongs to floor elevation, not to
 * a 2D grid).
 */
export function snapDeltaToGrid(delta: Vec3, step: number): Vec3 {
  if (step <= 0) return delta;
  return [
    Math.round(delta[0] / step) * step,
    delta[1],
    Math.round(delta[2] / step) * step,
  ];
}

// ── Live drag session ───────────────────────────────────────

export interface TranslateDragSession {
  /** World-space cursor hit when pointer-down happened. */
  startHit: Vec3;
  /** Group centroid at start of drag — the "visual anchor" the gizmo sits on. */
  startCentroid: Vec3;
}

export function beginTranslateDrag(startHit: Vec3, startCentroid: Vec3): TranslateDragSession {
  return { startHit, startCentroid };
}

/**
 * Given the current cursor hit + any modifier constraints, compute the
 * delta to apply relative to the start of the drag. Caller then applies
 * `translateGroup(input, result.delta)` and updates the visible gizmo
 * position to `result.newCentroid`.
 */
export interface DragToDeltaOpts {
  constrainToAxis?: boolean;  // Shift held
  snapStep?: number;          // Ctrl held → pass grid step (e.g. 1 ft)
}

export function dragToTranslation(
  session: TranslateDragSession,
  currentHit: Vec3,
  opts: DragToDeltaOpts = {},
): { delta: Vec3; newCentroid: Vec3 } {
  let delta: Vec3 = [
    currentHit[0] - session.startHit[0],
    currentHit[1] - session.startHit[1],
    currentHit[2] - session.startHit[2],
  ];
  if (opts.constrainToAxis) delta = constrainToDominantAxis(delta);
  if (opts.snapStep && opts.snapStep > 0) delta = snapDeltaToGrid(delta, opts.snapStep);
  return {
    delta,
    newCentroid: translateVec(session.startCentroid, delta),
  };
}

// ── Centroid (shared with groupRotation) ────────────────────

/** Arithmetic mean of every pipe point + fixture position. */
export function computeCentroid(
  pipes: readonly TranslatablePipe[],
  fixtures: readonly TranslatableFixture[],
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
