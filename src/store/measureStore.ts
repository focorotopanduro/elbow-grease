/**
 * MeasureStore — ruler measurements + scale calibration.
 *
 * Two concerns in one store because they share the same click-click UX:
 *
 *   Ruler      Click two points → a persistent dimension line with the
 *              distance label. Used for measuring arbitrary run length,
 *              clearance, etc.
 *
 *   Scale      Click two points + enter their REAL-WORLD distance →
 *              a scale factor is stored that the grid, labels, and
 *              backdrop image can be multiplied by to match the
 *              underlying drawing.
 *
 * The active mode is:
 *   'off'   — neither tool active
 *   'ruler' — next clicks record a measurement
 *   'scale' — next clicks sample a distance; after second point we
 *             open a dialog for the user to enter real-world feet
 *
 * Measurements are 2D (X/Z plane) by default, but we store full 3D
 * points so future elevation-view measurements work too.
 */

import { create } from 'zustand';

export type Vec3 = [number, number, number];

export interface Measurement {
  id: string;
  a: Vec3;
  b: Vec3;
  label?: string;
  createdTs: number;
  /** Pin to view even when tool inactive. */
  pinned: boolean;
}

export type MeasureMode = 'off' | 'ruler' | 'scale';

interface MeasureState {
  mode: MeasureMode;
  /** Pending first click while picking a measurement. */
  pendingStart: Vec3 | null;
  /** Cursor position used for the live preview. */
  previewEnd: Vec3 | null;
  measurements: Record<string, Measurement>;

  /** World units per foot. Default 1 means "1 world unit == 1 foot". */
  scaleFactor: number;
  /** Sampled pair awaiting real-world entry, for the scale dialog. */
  pendingScalePair: { a: Vec3; b: Vec3 } | null;

  setMode: (m: MeasureMode) => void;
  setPendingStart: (pt: Vec3 | null) => void;
  setPreviewEnd: (pt: Vec3 | null) => void;

  commitMeasurement: (a: Vec3, b: Vec3, label?: string) => string;
  removeMeasurement: (id: string) => void;
  togglePin: (id: string) => void;
  clearAllUnpinned: () => void;

  // Scale
  proposeScalePair: (a: Vec3, b: Vec3) => void;
  applyScaleFromRealFeet: (realFeet: number) => void;
  resetScale: () => void;
  cancelScale: () => void;
}

let seq = 0;
function mid(): string {
  seq = (seq + 1) & 0xffff;
  return `m_${Date.now().toString(36)}_${seq.toString(36)}`;
}

export const useMeasureStore = create<MeasureState>((set, get) => ({
  mode: 'off',
  pendingStart: null,
  previewEnd: null,
  measurements: {},
  scaleFactor: 1,
  pendingScalePair: null,

  setMode: (m) => {
    set({ mode: m, pendingStart: null, previewEnd: null });
  },
  setPendingStart: (pt) => set({ pendingStart: pt }),
  setPreviewEnd: (pt) => set({ previewEnd: pt }),

  commitMeasurement: (a, b, label) => {
    const id = mid();
    set((s) => ({
      measurements: {
        ...s.measurements,
        [id]: { id, a, b, label, createdTs: Date.now(), pinned: false },
      },
      pendingStart: null,
      previewEnd: null,
    }));
    return id;
  },

  removeMeasurement: (id) => {
    set((s) => {
      const copy = { ...s.measurements };
      delete copy[id];
      return { measurements: copy };
    });
  },

  togglePin: (id) => {
    set((s) => {
      const m = s.measurements[id];
      if (!m) return s;
      return { measurements: { ...s.measurements, [id]: { ...m, pinned: !m.pinned } } };
    });
  },

  clearAllUnpinned: () => {
    set((s) => {
      const kept: Record<string, Measurement> = {};
      for (const [id, m] of Object.entries(s.measurements)) {
        if (m.pinned) kept[id] = m;
      }
      return { measurements: kept };
    });
  },

  proposeScalePair: (a, b) => {
    set({ pendingScalePair: { a, b }, mode: 'scale', pendingStart: null, previewEnd: null });
  },

  applyScaleFromRealFeet: (realFeet) => {
    const pair = get().pendingScalePair;
    if (!pair || realFeet <= 0) return;
    const dx = pair.b[0] - pair.a[0];
    const dy = pair.b[1] - pair.a[1];
    const dz = pair.b[2] - pair.a[2];
    const measured = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (measured < 0.001) return;
    const factor = realFeet / measured;
    set((s) => ({
      scaleFactor: s.scaleFactor * factor,
      pendingScalePair: null,
      mode: 'off',
    }));
  },

  resetScale: () => set({ scaleFactor: 1 }),

  cancelScale: () => set({ pendingScalePair: null, mode: 'off' }),
}));
