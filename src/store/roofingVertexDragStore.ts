/**
 * roofingVertexDragStore — Phase 14.R.18.
 *
 * Transient drag-session state for the "grab a polygon vertex and
 * move it" tool. Mirrors R.8's section-drag pattern but at the
 * sub-section granularity of individual polygon vertices.
 *
 * The store holds:
 *   • The section being edited + the vertex index being moved
 *   • Anchors captured at pointer-down (pointerStart + vertexStart)
 *   • A pre-drag snapshot of the entire roofStore — pushed onto the
 *     undo stack on drag end so Ctrl+Z rolls back to the pre-drag
 *     polygon in one step (not 60 entries per second).
 *
 * Lifecycle:
 *   1. PolygonVertexHandles.onPointerDown on a handle →
 *      `beginDrag({ sectionId, vertexIdx, pointerStart,
 *                   vertexStart, preDragSnapshot })`.
 *   2. VertexDragInteraction.onPointerMove → compute new vertex
 *      position via R.8's `dragDelta` helper, call
 *      `roofStore.updatePolygonVertexLive(sid, idx, pos)` (no
 *      undo push).
 *   3. VertexDragInteraction.onPointerUp →
 *      `roofStore.pushUndoSnapshot(preDragSnapshot)` (one undo entry
 *      for the whole drag), then `endDrag()`.
 *   4. Escape from anywhere → restore the original vertex position
 *      via `updatePolygonVertexLive(vertexStart)`, then `endDrag()`.
 */

import { create } from 'zustand';
import type { RoofGraphSnapshot } from '@engine/roofing/RoofGraph';

/** Ground-plane (X, Z) in world feet — same shape as R.8 drag store. */
export type GroundPoint = readonly [number, number];

export type VertexDragMode = 'idle' | 'dragging';

export interface VertexDragState {
  mode: VertexDragMode;
  /** Section whose polygon is being edited. Null while idle. */
  sectionId: string | null;
  /** Index into the section's polygon array. -1 while idle. */
  vertexIdx: number;
  /** Pointer world-XZ captured at pointer-down. */
  pointerStart: GroundPoint | null;
  /** Polygon-vertex world-XZ captured at pointer-down. Used for both
   *  delta math AND as the restoration target on ESC abort. */
  vertexStart: GroundPoint | null;
  /** Snapshot of the roofStore captured AT drag start. Pushed onto
   *  undoStack on drag end so Ctrl+Z rolls back to the pre-drag state. */
  preDragSnapshot: RoofGraphSnapshot | null;

  beginDrag: (args: {
    sectionId: string;
    vertexIdx: number;
    pointerStart: GroundPoint;
    vertexStart: GroundPoint;
    preDragSnapshot: RoofGraphSnapshot;
  }) => void;
  endDrag: () => void;
}

export const useRoofingVertexDragStore = create<VertexDragState>((set) => ({
  mode: 'idle',
  sectionId: null,
  vertexIdx: -1,
  pointerStart: null,
  vertexStart: null,
  preDragSnapshot: null,

  beginDrag: ({ sectionId, vertexIdx, pointerStart, vertexStart, preDragSnapshot }) =>
    set({
      mode: 'dragging',
      sectionId,
      vertexIdx,
      pointerStart,
      vertexStart,
      preDragSnapshot,
    }),

  endDrag: () => set({
    mode: 'idle',
    sectionId: null,
    vertexIdx: -1,
    pointerStart: null,
    vertexStart: null,
    preDragSnapshot: null,
  }),
}));
