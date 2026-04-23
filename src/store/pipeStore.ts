/**
 * Pipe Store — Zustand single source of truth for committed pipes.
 *
 * Subscribes to EV.PIPE_COMPLETE from the EventBus and stores
 * every committed pipe route. The PipeRenderer reads from this
 * store to render solid 3D TubeGeometry.
 *
 * Also subscribes to SIM_MSG.PIPES_SIZED from the simulation
 * MessageBus to update diameters after the solver runs.
 */

import { create } from 'zustand';
import { eventBus } from '@core/EventBus';
import { EV, type Vec3, type PipeCompletePayload } from '@core/events';
import { simBus, SIM_MSG, type SimMessage } from '../engine/graph/MessageBus';
import type { SystemType } from '../engine/graph/GraphNode';
import type { SizingResult } from '../engine/solver/PipeSizer';
import { getFlag } from '@store/featureFlagStore';

// ── Diameter-to-color map (QuickPlumb Pro style: coded by size) ─

// User-spec diameter color table (QuickPlumb-Pro style, at-a-glance
// size recognition):
//   3"    → GREEN   (main branch drains)
//   2"    → ORANGE  (fixture drain / common vent)
//   1.5"  → PURPLE  (branch lines / trap arm)
//   Small supply (½"–1") → blue family
//   Large drains (4"+)   → red → brown → grey
export const DIAMETER_COLORS: Record<string, string> = {
  '0.375': '#4fc3f7', // sky blue
  '0.5':   '#4fc3f7',
  '0.75':  '#29b6f6', // azure
  '1':     '#29b6f6',
  '1.25':  '#ab47bc', // purple (shares with 1.5" — near sizes read alike)
  '1.5':   '#ab47bc', // PURPLE
  '2':     '#ffa726', // ORANGE
  '2.5':   '#ffa726',
  '3':     '#66bb6a', // GREEN
  '4':     '#ef5350', // red
  '5':     '#ef5350',
  '6':     '#8d4e17', // brown
  '8':     '#78909c', // grey
  '10':    '#78909c',
  '12':    '#78909c',
};

export function getColorForDiameter(diameter: number): string {
  // Find closest match
  const key = String(diameter);
  if (DIAMETER_COLORS[key]) return DIAMETER_COLORS[key]!;

  // Fallback: find nearest
  const sizes = Object.keys(DIAMETER_COLORS).map(Number).sort((a, b) => a - b);
  const closest = sizes.reduce((prev, curr) =>
    Math.abs(curr - diameter) < Math.abs(prev - diameter) ? curr : prev,
  );
  return DIAMETER_COLORS[String(closest)] ?? '#ffa726';
}

/**
 * Phase 14.V — materials that are supply-side in 90% of real use.
 * Used by `addPipe` to pre-assign `system: 'cold_supply'` so the
 * PipeMaterial system-color map picks up the right blue color
 * immediately, instead of defaulting to 'waste' and rendering white.
 */
function isSupplyDefaultMaterial(material: string): boolean {
  return (
    material === 'pex'
    || material === 'cpvc'
    || material === 'copper_type_l'
    || material === 'copper_type_m'
  );
}

// ── Types ───────────────────────────────────────────────────────

export interface CommittedPipe {
  id: string;
  points: Vec3[];
  diameter: number;
  material: string;
  system: SystemType;
  color: string;
  visible: boolean;
  selected: boolean;
}

interface PipeCommand {
  type: 'add' | 'remove';
  pipe: CommittedPipe;
}

// ── Pivot mode state ────────────────────────────────────────────

export interface PivotSession {
  pipeId: string;
  /** Which endpoint the user grabbed ('start' = point[0], 'end' = last). */
  grabbedEnd: 'start' | 'end';
  /** Fixed axis point (the opposite endpoint). */
  anchor: Vec3;
  /** Original grabbed endpoint position (for delta calc). */
  grabbedOrig: Vec3;
  /** Original full point list (for snap-back if cancel). */
  originalPoints: Vec3[];
  /** Current snapped angle (radians). Updated per-frame during drag. */
  currentSnappedAngle: number;
  /** Is current raw angle within snap tolerance? */
  isLegal: boolean;
  /** Fitting name for the current snap (e.g. "1/4 bend (90°)"). */
  fittingName: string;
}

interface PipeState {
  pipes: Record<string, CommittedPipe>;
  pipeOrder: string[];
  selectedId: string | null;
  undoStack: PipeCommand[];
  redoStack: PipeCommand[];
  pivotSession: PivotSession | null;

  addPipe: (payload: PipeCompletePayload) => void;
  removePipe: (id: string) => void;
  updateDiameter: (id: string, diameter: number) => void;
  /**
   * Phase 14.M — replace a pipe's polyline points wholesale. Used by
   * group rotation (and any future group-translate) to set transformed
   * coordinates atomically. No-op when the pipe doesn't exist.
   */
  setPoints: (id: string, points: Vec3[]) => void;
  /** Phase 14.N — change a pipe's material. Color is NOT auto-
   *  recomputed (color is driven by diameter). No-op if the pipe
   *  doesn't exist or the material is already the target value. */
  setMaterial: (id: string, material: string) => void;
  /** Phase 14.N — change a pipe's system type. No-op if missing. */
  setSystem: (id: string, system: SystemType) => void;
  selectPipe: (id: string | null) => void;
  setVisibility: (id: string, visible: boolean) => void;
  setSystemVisibility: (system: SystemType, visible: boolean) => void;
  undo: () => void;
  redo: () => void;

  /**
   * Phase 7.A — insert a new point into an existing pipe's polyline.
   * Used by the tee-from-middle-drag flow: splitting a straight pipe
   * at segment `segmentIdx` with the new vertex at `position`.
   *
   * No-op (silent) if the pipe doesn't exist or segmentIdx is out of
   * range. Post-condition: pipe.points.length grows by 1, the new
   * point sits at segmentIdx+1.
   */
  insertAnchor: (pipeId: string, segmentIdx: number, position: Vec3) => void;

  // Pivot actions
  beginPivot: (pipeId: string, grabbedEnd: 'start' | 'end') => void;
  updatePivot: (snappedAngle: number, isLegal: boolean, fittingName: string) => void;
  commitPivot: (finalPoints: Vec3[]) => void;
  cancelPivot: () => void;
}

// ── Store ───────────────────────────────────────────────────────

export const usePipeStore = create<PipeState>((set, get) => ({
  pipes: {},
  pipeOrder: [],
  selectedId: null,
  undoStack: [],
  redoStack: [],
  pivotSession: null,

  addPipe: (payload) => {
    // Phase 14.V — default system inferred from material.
    //   PEX / copper L / cpvc / copper M → cold_supply (supply-side material)
    //   everything else (PVC, ABS, cast iron, steel, ductile) → waste
    // Inference is non-binding: the solver / user can reclassify the
    // pipe later. This just gives the RIGHT initial color for PEX
    // supply runs so they render blue immediately instead of white
    // until the user remembers to change the system assignment.
    const defaultSystem: SystemType = isSupplyDefaultMaterial(payload.material)
      ? 'cold_supply'
      : 'waste';
    const pipe: CommittedPipe = {
      id: payload.id,
      points: payload.points,
      diameter: payload.diameter,
      material: payload.material,
      system: defaultSystem,
      color: getColorForDiameter(payload.diameter),
      visible: true,
      selected: false,
    };

    set((state) => ({
      pipes: { ...state.pipes, [pipe.id]: pipe },
      pipeOrder: [...state.pipeOrder, pipe.id],
      undoStack: [...state.undoStack.slice(-49), { type: 'add', pipe }],
      redoStack: [],
    }));
  },

  removePipe: (id) => {
    const pipe = get().pipes[id];
    if (!pipe) return;

    set((state) => {
      const { [id]: _, ...rest } = state.pipes;
      return {
        pipes: rest,
        pipeOrder: state.pipeOrder.filter((pid) => pid !== id),
        selectedId: state.selectedId === id ? null : state.selectedId,
        undoStack: [...state.undoStack.slice(-49), { type: 'remove', pipe }],
        redoStack: [],
      };
    });

    eventBus.emit('pipe:removed', { id });
  },

  updateDiameter: (id, diameter) => {
    set((state) => {
      const pipe = state.pipes[id];
      if (!pipe) return state;
      return {
        pipes: {
          ...state.pipes,
          [id]: { ...pipe, diameter, color: getColorForDiameter(diameter) },
        },
      };
    });
  },

  setPoints: (id, points) => {
    set((state) => {
      const pipe = state.pipes[id];
      if (!pipe) return state;
      return {
        pipes: { ...state.pipes, [id]: { ...pipe, points } },
      };
    });
  },

  setMaterial: (id, material) => {
    set((state) => {
      const pipe = state.pipes[id];
      if (!pipe || pipe.material === material) return state;
      return {
        pipes: { ...state.pipes, [id]: { ...pipe, material } },
      };
    });
  },

  setSystem: (id, system) => {
    set((state) => {
      const pipe = state.pipes[id];
      if (!pipe || pipe.system === system) return state;
      return {
        pipes: { ...state.pipes, [id]: { ...pipe, system } },
      };
    });
  },

  selectPipe: (id) => {
    set((state) => {
      const newPipes = { ...state.pipes };
      // Deselect previous
      if (state.selectedId && newPipes[state.selectedId]) {
        newPipes[state.selectedId] = { ...newPipes[state.selectedId]!, selected: false };
      }
      // Select new
      if (id && newPipes[id]) {
        newPipes[id] = { ...newPipes[id]!, selected: true };
      }
      return { pipes: newPipes, selectedId: id };
    });
  },

  setVisibility: (id, visible) => {
    set((state) => {
      const pipe = state.pipes[id];
      if (!pipe) return state;
      return {
        pipes: { ...state.pipes, [id]: { ...pipe, visible } },
      };
    });
  },

  setSystemVisibility: (system, visible) => {
    set((state) => {
      const newPipes = { ...state.pipes };
      for (const [id, pipe] of Object.entries(newPipes)) {
        if (pipe.system === system) {
          newPipes[id] = { ...pipe, visible };
        }
      }
      return { pipes: newPipes };
    });
  },

  undo: () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return;

    const cmd = undoStack[undoStack.length - 1]!;
    set((state) => ({ undoStack: state.undoStack.slice(0, -1) }));

    if (cmd.type === 'add') {
      // Reverse: remove the pipe
      const pipe = get().pipes[cmd.pipe.id];
      if (pipe) {
        set((state) => {
          const { [cmd.pipe.id]: _, ...rest } = state.pipes;
          return {
            pipes: rest,
            pipeOrder: state.pipeOrder.filter((pid) => pid !== cmd.pipe.id),
            redoStack: [...state.redoStack, cmd],
          };
        });
        eventBus.emit('pipe:removed', { id: cmd.pipe.id });
      }
    } else {
      // Reverse: re-add the pipe
      set((state) => ({
        pipes: { ...state.pipes, [cmd.pipe.id]: cmd.pipe },
        pipeOrder: [...state.pipeOrder, cmd.pipe.id],
        redoStack: [...state.redoStack, cmd],
      }));
    }
  },

  redo: () => {
    const { redoStack } = get();
    if (redoStack.length === 0) return;

    const cmd = redoStack[redoStack.length - 1]!;
    set((state) => ({ redoStack: state.redoStack.slice(0, -1) }));

    if (cmd.type === 'add') {
      set((state) => ({
        pipes: { ...state.pipes, [cmd.pipe.id]: cmd.pipe },
        pipeOrder: [...state.pipeOrder, cmd.pipe.id],
        undoStack: [...state.undoStack, cmd],
      }));
    } else {
      set((state) => {
        const { [cmd.pipe.id]: _, ...rest } = state.pipes;
        return {
          pipes: rest,
          pipeOrder: state.pipeOrder.filter((pid) => pid !== cmd.pipe.id),
          undoStack: [...state.undoStack, cmd],
        };
      });
      eventBus.emit('pipe:removed', { id: cmd.pipe.id });
    }
  },

  // ── Phase 7.A: anchor insertion (tee-from-middle-drag) ──────

  insertAnchor: (pipeId, segmentIdx, position) => {
    set((state) => {
      const pipe = state.pipes[pipeId];
      if (!pipe) return state;
      // Valid segmentIdx range: 0 .. points.length - 2 (index of the
      // segment's LEADING point). An out-of-range index is a stale
      // session; silently ignore.
      if (segmentIdx < 0 || segmentIdx >= pipe.points.length - 1) return state;
      const newPoints: Vec3[] = [
        ...pipe.points.slice(0, segmentIdx + 1),
        position,
        ...pipe.points.slice(segmentIdx + 1),
      ];
      return {
        pipes: {
          ...state.pipes,
          [pipeId]: { ...pipe, points: newPoints },
        },
      };
    });
  },

  // ── Pivot actions ──────────────────────────────────────────

  beginPivot: (pipeId, grabbedEnd) => {
    const pipe = get().pipes[pipeId];
    if (!pipe) return;
    if (pipe.points.length < 2) return;

    const grabbedIdx = grabbedEnd === 'start' ? 0 : pipe.points.length - 1;
    const anchorIdx = grabbedEnd === 'start' ? pipe.points.length - 1 : 0;
    const grabbedOrig = pipe.points[grabbedIdx]!;
    const anchor = pipe.points[anchorIdx]!;

    set({
      pivotSession: {
        pipeId,
        grabbedEnd,
        anchor,
        grabbedOrig,
        originalPoints: [...pipe.points],
        currentSnappedAngle: 0,
        isLegal: true,
        fittingName: 'Straight (0°)',
      },
      selectedId: pipeId,
    });
  },

  updatePivot: (snappedAngle, isLegal, fittingName) => {
    set((state) => {
      if (!state.pivotSession) return state;
      return {
        pivotSession: {
          ...state.pivotSession,
          currentSnappedAngle: snappedAngle,
          isLegal,
          fittingName,
        },
      };
    });
  },

  commitPivot: (finalPoints) => {
    const session = get().pivotSession;
    if (!session) return;

    // Apply the new point array to the pipe
    set((state) => {
      const pipe = state.pipes[session.pipeId];
      if (!pipe) return { pivotSession: null };

      const updatedPipe: CommittedPipe = { ...pipe, points: finalPoints };

      // Push an undo command that can restore the original geometry
      const cmd: PipeCommand = {
        type: 'add',
        pipe: { ...pipe, points: session.originalPoints },
      };

      return {
        pipes: { ...state.pipes, [session.pipeId]: updatedPipe },
        pivotSession: null,
        // Keep undo history coherent — store the original shape so undo restores it
        undoStack: [...state.undoStack.slice(-49), cmd],
        redoStack: [],
      };
    });

    // Emit events so solver + renderers recompute
    eventBus.emit('pipe:pivoted', { id: session.pipeId });
  },

  cancelPivot: () => {
    set({ pivotSession: null });
  },
}));

// ── Boot function (call once at app startup) ────────────────────

let booted = false;

export function bootPipeStore(): void {
  if (booted) return;
  booted = true;

  // Listen for committed pipe routes.
  //
  // Phase 1 dual-path: when the `commandBus` flag is ON, this direct
  // mutation is replaced by the EventToCommand translator dispatching
  // `pipe.add`, which calls addPipe() via the handler. Skipping here
  // prevents double-adds (the handler's own precondition would otherwise
  // reject the second call and litter the log with "already exists"
  // rejections). When the flag is OFF we retain today's behavior.
  eventBus.on<PipeCompletePayload>(EV.PIPE_COMPLETE, (payload) => {
    if (getFlag('commandBus')) return;
    usePipeStore.getState().addPipe(payload);
  });

  // Listen for solver diameter updates (PIPES_SIZED from Web Worker)
  // Edge IDs follow format: edge-{pipeId}-{segmentIndex}
  simBus.on<SimMessage<SizingResult[]>>(SIM_MSG.PIPES_SIZED, (msg) => {
    const results = msg.payload as unknown as SizingResult[];
    if (!Array.isArray(results)) return;

    const store = usePipeStore.getState();
    for (const result of results) {
      if (!result.changed) continue;

      // Extract pipe ID from edge ID: "edge-{pipeId}-{segIndex}" → pipeId
      const parts = result.edgeId.split('-');
      // Format: edge-route-{N}-{segIdx} → pipeId = "route-{N}"
      if (parts.length >= 3) {
        const pipeId = parts.slice(1, -1).join('-');
        if (store.pipes[pipeId]) {
          store.updateDiameter(pipeId, result.newDiameter);
        }
      }
    }
  });
}
