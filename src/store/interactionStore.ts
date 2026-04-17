/**
 * Interaction Store — mode system + draw state + settings.
 *
 * Modes: Navigate (orbit) | Draw (click-to-place) | Select (inspect)
 *
 * Draw planes:
 *   H = horizontal (Y=0 ground plane, default)
 *   V = vertical (locks to XY or ZY plane based on camera angle)
 *
 * Press V to toggle vertical drawing, H to go back to horizontal.
 * In vertical mode, cursor moves up/down (Y axis) instead of along ground.
 */

import { create } from 'zustand';
import type { Vec3 } from '@core/events';
import type { PipeMaterial } from '../engine/graph/GraphEdge';

export type InteractionMode = 'navigate' | 'draw' | 'select';
export type DrawPlane = 'horizontal' | 'vertical';
export type PipeRenderQuality = 'fast' | '3d';

interface InteractionState {
  mode: InteractionMode;
  drawPoints: Vec3[];
  isDrawing: boolean;
  cursorPos: Vec3 | null;
  gridSnap: number;
  pipeQuality: PipeRenderQuality;
  /** H or V drawing plane. */
  drawPlane: DrawPlane;
  /** Pipe diameter for new pipes (inches). */
  drawDiameter: number;
  /** Pipe material for new pipes. */
  drawMaterial: PipeMaterial;
  /** Fixed Y height for vertical drawing anchor. */
  verticalAnchorY: number;

  setMode: (mode: InteractionMode) => void;
  addDrawPoint: (point: Vec3) => void;
  clearDraw: () => void;
  finishDraw: () => Vec3[] | null;
  setCursorPos: (pos: Vec3 | null) => void;
  togglePipeQuality: () => void;
  setDrawPlane: (plane: DrawPlane) => void;
  toggleDrawPlane: () => void;
  setDrawDiameter: (d: number) => void;
  setDrawMaterial: (m: PipeMaterial) => void;
}

function snapToGrid(pos: Vec3, grid: number): Vec3 {
  return [
    Math.round(pos[0] / grid) * grid,
    Math.round(pos[1] / grid) * grid,
    Math.round(pos[2] / grid) * grid,
  ];
}

export const useInteractionStore = create<InteractionState>((set, get) => ({
  mode: 'navigate',
  drawPoints: [],
  isDrawing: false,
  cursorPos: null,
  gridSnap: 0.5,
  pipeQuality: '3d',
  drawPlane: 'horizontal',
  drawDiameter: 2,
  drawMaterial: 'pvc_sch40',
  verticalAnchorY: 0,

  setMode: (mode) => {
    set({ mode, drawPoints: [], isDrawing: false });
  },

  addDrawPoint: (point) => {
    const snapped = snapToGrid(point, get().gridSnap);
    const points = get().drawPoints;

    if (points.length > 0) {
      const last = points[points.length - 1]!;
      const dx = last[0] - snapped[0];
      const dy = last[1] - snapped[1];
      const dz = last[2] - snapped[2];
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.1) return;
    }

    // In vertical mode, anchor the first point's XZ for subsequent points
    if (get().drawPlane === 'vertical' && points.length === 0) {
      set({ verticalAnchorY: snapped[1] });
    }

    set({ drawPoints: [...points, snapped], isDrawing: true });
  },

  clearDraw: () => {
    set({ drawPoints: [], isDrawing: false, mode: 'navigate' });
  },

  finishDraw: () => {
    const points = get().drawPoints;
    if (points.length < 2) {
      set({ drawPoints: [], isDrawing: false, mode: 'navigate' });
      return null;
    }
    const result = [...points];
    set({ drawPoints: [], isDrawing: false, mode: 'navigate' });
    return result;
  },

  setCursorPos: (pos) => set({ cursorPos: pos }),
  togglePipeQuality: () => set((s) => ({ pipeQuality: s.pipeQuality === '3d' ? 'fast' : '3d' })),
  setDrawPlane: (plane) => set({ drawPlane: plane }),
  toggleDrawPlane: () => set((s) => ({ drawPlane: s.drawPlane === 'horizontal' ? 'vertical' : 'horizontal' })),
  setDrawDiameter: (d) => set({ drawDiameter: d }),
  setDrawMaterial: (m) => set({ drawMaterial: m }),
}));
