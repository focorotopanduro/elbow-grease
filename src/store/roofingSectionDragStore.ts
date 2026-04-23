/**
 * roofingSectionDragStore — Phase 14.R.8.
 *
 * Transient drag-session state for the "drag-to-move section" tool
 * in the roofing workspace. Mirrors the lifecycle shape of
 * `roofingDrawStore` + `roofingPdfCalibStore` — idle by default,
 * flips active only while a pointer is down on a section mesh.
 *
 * The store ONLY holds anchors (starting pointer + starting section
 * position). The movement math (delta → new section x/y) lives in
 * the UI layer so the store doesn't pull in `roofStore` as a
 * circular dependency, and so tests can run without React.
 *
 * Lifecycle:
 *   1. RoofSection3D.onPointerDown → `beginDrag(sid, pointer, pos)`.
 *      Also flips the section's selection via roofStore (the UI
 *      layer handles both).
 *   2. SectionDragInteraction ground catcher's `onPointerMove` →
 *      reads `pointerStart` + `sectionStart`, computes new position,
 *      calls `roofStore.moveSection(sid, x, y)`.
 *   3. SectionDragInteraction's `onPointerUp` → `endDrag()`.
 *
 *   Escape at any point → `endDrag()` (via the interaction's
 *   keyboard listener).
 */

import { create } from 'zustand';

/** Ground-plane (X, Z) in world feet — same shape as draw/calib stores. */
export type GroundPoint = readonly [number, number];

export type SectionDragMode = 'idle' | 'dragging';

export interface SectionDragState {
  mode: SectionDragMode;
  /** Which section is being moved. `null` when `mode === 'idle'`. */
  sectionId: string | null;
  /** Pointer position captured at pointer-down, in world ground coords. */
  pointerStart: GroundPoint | null;
  /** Section (x, y) captured at pointer-down, in world ground coords. */
  sectionStart: GroundPoint | null;

  beginDrag: (sectionId: string, pointer: GroundPoint, sectionPos: GroundPoint) => void;
  endDrag: () => void;
}

export const useRoofingSectionDragStore = create<SectionDragState>((set) => ({
  mode: 'idle',
  sectionId: null,
  pointerStart: null,
  sectionStart: null,

  beginDrag: (sectionId, pointer, sectionPos) => set({
    mode: 'dragging',
    sectionId,
    pointerStart: pointer,
    sectionStart: sectionPos,
  }),

  endDrag: () => set({
    mode: 'idle',
    sectionId: null,
    pointerStart: null,
    sectionStart: null,
  }),
}));

// ── Pure delta math ─────────────────────────────────────────────

/**
 * Given anchors captured at pointer-down and the current pointer
 * position, return the section's new (x, y). Pure — safe to unit
 * test without a DOM.
 *
 * Optionally snaps the NEW position to `gridSnap` feet (default
 * 0.5 ft) so dragged sections honor the same grid as drawn ones.
 * Set `gridSnap <= 0` to disable.
 */
export function dragDelta(
  pointerStart: GroundPoint,
  sectionStart: GroundPoint,
  currentPointer: GroundPoint,
  gridSnap: number = 0.5,
): { x: number; y: number } {
  const dx = currentPointer[0] - pointerStart[0];
  const dy = currentPointer[1] - pointerStart[1];
  const nx = sectionStart[0] + dx;
  const ny = sectionStart[1] + dy;
  if (gridSnap <= 0) return { x: nx, y: ny };
  return {
    x: Math.round(nx / gridSnap) * gridSnap,
    y: Math.round(ny / gridSnap) * gridSnap,
  };
}
