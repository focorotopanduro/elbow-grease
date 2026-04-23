/**
 * roofingAxisDragStore — Phase 14.R.23.
 *
 * Transient drag-session state for the visual axis-rotation handle
 * on convex-polygon gable/shed sections. Mirrors R.19's rotation
 * drag pattern but writes `section.roofAxisOverrideDeg` (R.20's
 * override field) instead of rotating the section geometry.
 *
 * Lifecycle:
 *   1. AxisRotationGizmo pointer-down on the arrowhead →
 *      `beginDrag({ sectionId, center, startPointerAngle,
 *                   anchorAxisDeg, preDragSnapshot })`.
 *   2. Ground-plane catcher pointer-move: compute current pointer
 *      angle relative to `center`, derive angle delta from
 *      `startPointerAngle`, call `roofStore.updateSectionLive(sid,
 *      { roofAxisOverrideDeg: anchorAxisDeg + delta })`.
 *   3. Pointer-up: `pushUndoSnapshot(preDragSnapshot)`, `endDrag()`.
 *   4. Escape: restore via `updateSectionLive(sid,
 *      { roofAxisOverrideDeg: anchorAxisDeg })`, `endDrag()`.
 */

import { create } from 'zustand';
import type { RoofGraphSnapshot } from '@engine/roofing/RoofGraph';

export type GroundPoint = readonly [number, number];
export type AxisDragMode = 'idle' | 'dragging';

export interface AxisDragState {
  mode: AxisDragMode;
  sectionId: string | null;
  /** Rotation pivot = polygon centroid (where the gizmo anchors). */
  center: GroundPoint | null;
  /** Pointer angle (radians, atan2 from center) at drag start. */
  startPointerAngle: number | null;
  /** Section's axis angle (degrees) at drag start. Could be the
   *  explicit override OR the bbox auto-pick value. */
  anchorAxisDeg: number;
  /** Store snapshot captured at drag start — pushed to undoStack on
   *  drag end so the whole drag is a single undo step. */
  preDragSnapshot: RoofGraphSnapshot | null;

  beginDrag: (args: {
    sectionId: string;
    center: GroundPoint;
    startPointerAngle: number;
    anchorAxisDeg: number;
    preDragSnapshot: RoofGraphSnapshot;
  }) => void;
  endDrag: () => void;
}

export const useRoofingAxisDragStore = create<AxisDragState>((set) => ({
  mode: 'idle',
  sectionId: null,
  center: null,
  startPointerAngle: null,
  anchorAxisDeg: 0,
  preDragSnapshot: null,

  beginDrag: ({ sectionId, center, startPointerAngle, anchorAxisDeg, preDragSnapshot }) =>
    set({
      mode: 'dragging',
      sectionId,
      center,
      startPointerAngle,
      anchorAxisDeg,
      preDragSnapshot,
    }),

  endDrag: () => set({
    mode: 'idle',
    sectionId: null,
    center: null,
    startPointerAngle: null,
    anchorAxisDeg: 0,
    preDragSnapshot: null,
  }),
}));
