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
import { applyDrawConstraints } from '@core/pipe/angleSnap';

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

  /**
   * Phase 6: camera/orbit navigation freeze. Held `true` while the user
   * is holding the freeze key (Space by default) — OrbitControlsGate
   * reads this and disables all orbit gestures so a click-drag to
   * extend a pipe can't fight the pan/rotate listener.
   */
  navFrozen: boolean;

  /**
   * Phase 14.AD.23 — ortho click-drag drawing mode.
   *
   * When `true` (default) AND the camera is in an orthographic
   * view (top / front / side / bottom), clicking on an existing
   * pipe and dragging creates a new branch pipe (from a midpoint)
   * or extends the pipe (from an endpoint). A click WITHOUT drag
   * selects the pipe. Delete-key then deletes it.
   *
   * Off: falls back to the classic click-to-place-points draw tool.
   * Toggle via the toolbar checkbox or Shift+O.
   */
  orthoClickDragMode: boolean;

  setMode: (mode: InteractionMode) => void;
  addDrawPoint: (point: Vec3) => void;
  /**
   * Phase 14.S — Add a draw point WITHOUT applying the legal-angle /
   * rise / length-quantize constraint pipeline. Used for Alt-held
   * clicks where the user intentionally wants a free-angle placement
   * (one-off adapter fitting, odd site conditions). Still grid-snaps
   * so the point lands deterministically.
   */
  addDrawPointRaw: (point: Vec3) => void;
  /**
   * Phase 14.S — Pop the most recent draw point from the in-progress
   * polyline. Used by Backspace during draw. Keeps the session alive
   * (mode stays 'draw', `isDrawing` stays true) unless the pop leaves
   * the polyline empty — then we drop `isDrawing` but stay in 'draw'
   * mode so the user can reposition and click again.
   */
  popDrawPoint: () => void;
  clearDraw: () => void;
  finishDraw: () => Vec3[] | null;
  setCursorPos: (pos: Vec3 | null) => void;
  togglePipeQuality: () => void;
  setDrawPlane: (plane: DrawPlane) => void;
  toggleDrawPlane: () => void;
  setDrawDiameter: (d: number) => void;
  setDrawMaterial: (m: PipeMaterial) => void;
  setNavFrozen: (frozen: boolean) => void;
  setOrthoClickDragMode: (enabled: boolean) => void;
  toggleOrthoClickDragMode: () => void;
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
  navFrozen: false,
  orthoClickDragMode: true,

  setMode: (mode) => {
    set({ mode, drawPoints: [], isDrawing: false });
  },

  addDrawPoint: (point) => {
    const points = get().drawPoints;
    const material = get().drawMaterial;
    const gridStep = get().gridSnap;

    // Phase 14.R — unified snap order that DOESN'T break legal angles.
    //
    // Previous code: grid-snap → angle-snap → grid-snap. The final
    // grid-snap ("re-snap to grid so the enforced-angle point still
    // lands on a grid vertex") broke 22.5°/45° angles almost always:
    // those non-orthogonal directions rarely land on a 0.5 ft grid
    // multiple, so the re-snap nudged them to a nearby grid point at
    // a DIFFERENT (illegal) angle. This was the root of the user's
    // "I draw a 45° segment and get 47°" report.
    //
    // New contract:
    //   • If no constraint applies (< 2 prior points, flexible
    //     material, or vertical draw plane — see below), snap to
    //     grid and that's it.
    //   • If constraint applies, snap the LENGTH to the grid along
    //     the legal direction, NOT the resulting XY/XZ coords. That
    //     way 10 ft @ 22.5° stays at 10 ft @ 22.5°, even though
    //     (9.24, 3.83) is off the 0.5 ft grid.
    const finalPoint = applyDrawConstraints(point, {
      points,
      material,
      drawPlane: get().drawPlane,
      gridStep,
    });

    if (points.length > 0) {
      const last = points[points.length - 1]!;
      const dx = last[0] - finalPoint[0];
      const dy = last[1] - finalPoint[1];
      const dz = last[2] - finalPoint[2];
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.1) return;
    }

    // In vertical mode, anchor the first point's XZ for subsequent points
    if (get().drawPlane === 'vertical' && points.length === 0) {
      set({ verticalAnchorY: finalPoint[1] });
    }

    set({ drawPoints: [...points, finalPoint], isDrawing: true });
  },

  addDrawPointRaw: (point) => {
    const points = get().drawPoints;
    const gridStep = get().gridSnap;
    // Grid-snap only — no angle / rise / length pipeline. Keeps the
    // commit deterministic (lands on the grid) but lets the user
    // pick any angle they want for this one click.
    const finalPoint: Vec3 = [
      Math.round(point[0] / gridStep) * gridStep,
      Math.round(point[1] / gridStep) * gridStep,
      Math.round(point[2] / gridStep) * gridStep,
    ];
    if (points.length > 0) {
      const last = points[points.length - 1]!;
      const dx = last[0] - finalPoint[0];
      const dy = last[1] - finalPoint[1];
      const dz = last[2] - finalPoint[2];
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.1) return;
    }
    if (get().drawPlane === 'vertical' && points.length === 0) {
      set({ verticalAnchorY: finalPoint[1] });
    }
    set({ drawPoints: [...points, finalPoint], isDrawing: true });
  },

  popDrawPoint: () => {
    const points = get().drawPoints;
    if (points.length === 0) return;
    const next = points.slice(0, -1);
    set({
      drawPoints: next,
      // Keep `isDrawing` true if any points remain; drop to false if
      // we just popped the last one. Mode stays 'draw' either way so
      // the user can keep clicking.
      isDrawing: next.length > 0,
    });
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
  setDrawMaterial: (m) => {
    // Phase 14.V — also reset draw diameter to a sensible default for
    // the new material. Switching to PEX with a leftover 3" or 4"
    // draw diameter draws gigantic supply pipes; Uponor AquaPEX
    // residential supply defaults to 3/4" for mains, 1/2" for
    // branches. Rigid materials default back to 2" (common DWV size).
    const current = get().drawDiameter;
    let nextDiameter = current;
    if ((m === 'pex' || m === 'cpvc' || m === 'copper_type_l' || m === 'copper_type_m')
        && current > 1) {
      nextDiameter = 0.75; // 3/4" default for supply
    } else if ((m === 'pvc_sch40' || m === 'pvc_sch80' || m === 'abs' || m === 'cast_iron')
        && current < 1.5) {
      nextDiameter = 2; // snap back to rough-in DWV default
    }
    set({ drawMaterial: m, drawDiameter: nextDiameter });
  },
  setNavFrozen: (frozen) => set({ navFrozen: frozen }),
  setOrthoClickDragMode: (enabled) => set({ orthoClickDragMode: enabled }),
  toggleOrthoClickDragMode: () => set((s) => ({ orthoClickDragMode: !s.orthoClickDragMode })),
}));
