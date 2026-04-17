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

// ── Diameter-to-color map (QuickPlumb Pro style: coded by size) ─

export const DIAMETER_COLORS: Record<string, string> = {
  '0.375': '#4fc3f7',
  '0.5':   '#4fc3f7',
  '0.75':  '#29b6f6',
  '1':     '#29b6f6',
  '1.25':  '#66bb6a',
  '1.5':   '#66bb6a',
  '2':     '#ffa726',
  '2.5':   '#ffa726',
  '3':     '#ef5350',
  '4':     '#ab47bc',
  '5':     '#8d6e63',
  '6':     '#8d6e63',
  '8':     '#78909c',
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
  selectPipe: (id: string | null) => void;
  setVisibility: (id: string, visible: boolean) => void;
  setSystemVisibility: (system: SystemType, visible: boolean) => void;
  undo: () => void;
  redo: () => void;

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
    const pipe: CommittedPipe = {
      id: payload.id,
      points: payload.points,
      diameter: payload.diameter,
      material: payload.material,
      system: 'waste', // default, updated by solver
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

  // Listen for committed pipe routes
  eventBus.on<PipeCompletePayload>(EV.PIPE_COMPLETE, (payload) => {
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
