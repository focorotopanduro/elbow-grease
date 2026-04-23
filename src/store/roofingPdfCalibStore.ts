/**
 * roofingPdfCalibStore — Phase 14.R.5.
 *
 * Transient calibration state for the PDF blueprint underlay. Not
 * persisted — lives only for the duration of the calibrate click
 * sequence. Separate from `roofStore.pdf` (persisted transform +
 * image) so the user flipping in and out of calibrate mode doesn't
 * leave stale draft state in the saved roof graph.
 *
 * Flow:
 *   1. RoofingPDFPanel → `beginCalibrate()`  → mode='calibrate-1'
 *   2. User clicks plane → `setFirstPoint(pt)` → mode='calibrate-2'
 *   3. User clicks plane → `setSecondPoint(pt)` → mode='enter-distance'
 *   4. User enters distance in the overlay dialog → RoofingPDFPanel
 *      calls `roofStore.calibratePdfFromWorld(p1, p2, ft)`, then
 *      `reset()` returns the store to idle.
 *   5. ESC or Cancel calls `reset()` at any step.
 */

import { create } from 'zustand';

/** Ground-plane (X, Z) in world feet. Same shape as the draw store. */
export type GroundPoint = readonly [number, number];

export type PdfCalibMode =
  | 'idle'
  | 'calibrate-1'       // waiting for the first click
  | 'calibrate-2'       // waiting for the second click
  | 'enter-distance';   // both points captured; awaiting numeric input

export interface PdfCalibState {
  mode: PdfCalibMode;
  firstPoint: GroundPoint | null;
  secondPoint: GroundPoint | null;

  beginCalibrate: () => void;
  setFirstPoint: (pt: GroundPoint) => void;
  setSecondPoint: (pt: GroundPoint) => void;
  reset: () => void;
}

export const useRoofingPdfCalibStore = create<PdfCalibState>((set) => ({
  mode: 'idle',
  firstPoint: null,
  secondPoint: null,

  beginCalibrate: () => set({
    mode: 'calibrate-1',
    firstPoint: null,
    secondPoint: null,
  }),

  setFirstPoint: (pt) => set({
    firstPoint: pt,
    mode: 'calibrate-2',
  }),

  setSecondPoint: (pt) => set({
    secondPoint: pt,
    mode: 'enter-distance',
  }),

  reset: () => set({
    mode: 'idle',
    firstPoint: null,
    secondPoint: null,
  }),
}));
