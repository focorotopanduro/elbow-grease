/**
 * roofingRotationDragStore — Phase 14.R.19.
 *
 * Transient drag-session state for rotating a roof section via the
 * ring gizmo. Mirrors R.8 (section move) and R.18 (vertex edit) in
 * spirit: high-frequency live updates during the drag, ONE undo
 * entry committed at the end via a pre-captured roofStore snapshot.
 *
 * The store keeps "anchor" state (pointer angle at pointer-down +
 * either the rect's rotation or the polygon as-of-drag-start) so
 * `roofStore.rotateSectionLive` can always re-derive the section's
 * geometry from stable starting values — this avoids numerical drift
 * that would accrue if we accumulated tiny deltas every pointer-move
 * call.
 *
 * Lifecycle:
 *   1. RotationGizmo pointer-down on the ring:
 *      `beginRotate({ sectionId, center, startPointerAngle,
 *                     anchorRotation, anchorPolygon,
 *                     preDragSnapshot })`.
 *   2. Ground-plane catcher pointer-move: compute current pointer
 *      angle relative to `center`, derive angleDelta from
 *      `startPointerAngle`, call `rotateSectionLive(sid, angleDelta,
 *      anchor)`.
 *   3. Pointer-up: `pushUndoSnapshot(preDragSnapshot)`, `endRotate()`.
 *   4. Escape: restore with `rotateSectionLive(sid, 0, anchor)`
 *      (0 delta = anchor state), then `endRotate()` without undo.
 */

import { create } from 'zustand';
import type { RoofGraphSnapshot } from '@engine/roofing/RoofGraph';

export type GroundPoint = readonly [number, number];
export type RotationDragMode = 'idle' | 'rotating';

export interface RotationDragState {
  mode: RotationDragMode;
  sectionId: string | null;
  /** Rotation pivot in world XZ — bbox center for rects, polygon
   *  centroid for polygon sections. */
  center: GroundPoint | null;
  /** Pointer angle (radians, atan2) captured at drag start. */
  startPointerAngle: number | null;
  /** Anchor state captured at drag start: rect sections use
   *  `rotation`, polygon sections use `polygon`. Both fields are
   *  passed verbatim to `roofStore.rotateSectionLive` on every
   *  pointer-move. */
  anchorRotation: number;
  anchorPolygon: ReadonlyArray<readonly [number, number]> | null;
  /** Snapshot of the roofStore at drag start. Pushed to undoStack on
   *  drag end so Ctrl+Z rolls back the full rotation in one step. */
  preDragSnapshot: RoofGraphSnapshot | null;

  beginRotate: (args: {
    sectionId: string;
    center: GroundPoint;
    startPointerAngle: number;
    anchorRotation: number;
    anchorPolygon: ReadonlyArray<readonly [number, number]> | null;
    preDragSnapshot: RoofGraphSnapshot;
  }) => void;
  endRotate: () => void;
}

export const useRoofingRotationDragStore = create<RotationDragState>((set) => ({
  mode: 'idle',
  sectionId: null,
  center: null,
  startPointerAngle: null,
  anchorRotation: 0,
  anchorPolygon: null,
  preDragSnapshot: null,

  beginRotate: ({
    sectionId, center, startPointerAngle,
    anchorRotation, anchorPolygon, preDragSnapshot,
  }) => set({
    mode: 'rotating',
    sectionId,
    center,
    startPointerAngle,
    anchorRotation,
    anchorPolygon,
    preDragSnapshot,
  }),

  endRotate: () => set({
    mode: 'idle',
    sectionId: null,
    center: null,
    startPointerAngle: null,
    anchorRotation: 0,
    anchorPolygon: null,
    preDragSnapshot: null,
  }),
}));

// ── Pure math ───────────────────────────────────────────────────

/**
 * Compute the signed angle delta (radians) between a drag-start
 * pointer angle and a current pointer angle, accounting for wrap-
 * around at ±π. Result is in the range (−π, π].
 */
export function rotationAngleDelta(
  startAngle: number,
  currentAngle: number,
): number {
  let delta = currentAngle - startAngle;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  return delta;
}

/** Snap a degree-valued angle to the nearest `stepDeg` multiple. */
export function snapDegrees(deg: number, stepDeg: number): number {
  if (stepDeg <= 0) return deg;
  return Math.round(deg / stepDeg) * stepDeg;
}
