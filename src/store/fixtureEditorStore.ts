/**
 * FixtureEditorStore — transient workbench state for the visual editor.
 *
 * When the user clicks "Visual Editor" in the FixtureParamWindow, we
 * clone the target fixture's params into staged state. Changes made in
 * the editor (drag handles, rotation ring, panel fields) only affect
 * this staged copy. On Apply → flush staged to the real fixtureStore.
 * On Cancel → discard.
 *
 * The editor also tracks which handle (connection point) is being
 * dragged so both top-view and 3D-view can highlight it in sync.
 */

import { create } from 'zustand';
import type { FixtureSubtype } from '../engine/graph/GraphNode';
import { defaultParamsFor } from '@core/fixtures/FixtureParams';

export type EditorView = 'top' | '3d' | 'elev' | 'tri';

interface FixtureEditorState {
  isOpen: boolean;
  fixtureId: string | null;
  subtype: FixtureSubtype | null;
  stagedParams: Record<string, unknown>;
  activeHandle: string | null;
  view: EditorView;
  /** Rotation ring visible? */
  showRotationHandle: boolean;
  /** Snap dimensions to 1/2 inch? */
  snapHalfInch: boolean;
  /** Show measurement labels between handles? */
  showDimensions: boolean;
  /** Show framing / wall outlines? */
  showWalls: boolean;
  /** Dirty flag: true once any change has been staged. */
  dirty: boolean;

  // Undo/Redo
  undoStack: Record<string, unknown>[];
  redoStack: Record<string, unknown>[];

  open: (fixtureId: string, subtype: FixtureSubtype, params: Record<string, unknown>) => void;
  close: () => void;
  setView: (view: EditorView) => void;
  setActiveHandle: (id: string | null) => void;

  // Staged mutations
  updateParam: (key: string, value: unknown) => void;
  bulkUpdate: (patch: Record<string, unknown>) => void;
  resetToDefaults: () => void;
  applyPreset: (preset: Record<string, unknown>) => void;

  // History
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Controls
  toggleRotationHandle: () => void;
  toggleSnapHalfInch: () => void;
  toggleDimensions: () => void;
  toggleWalls: () => void;

  // Mirror / Flip
  mirrorHorizontal: () => void;
  flipDrainSide: () => void;
}

const HISTORY_CAP = 40;

export const useFixtureEditorStore = create<FixtureEditorState>((set, get) => ({
  isOpen: false,
  fixtureId: null,
  subtype: null,
  stagedParams: {},
  activeHandle: null,
  view: 'tri',
  showRotationHandle: true,
  snapHalfInch: true,
  showDimensions: true,
  showWalls: true,
  dirty: false,
  undoStack: [],
  redoStack: [],

  open: (fixtureId, subtype, params) => {
    set({
      isOpen: true,
      fixtureId,
      subtype,
      stagedParams: { ...params },
      activeHandle: null,
      dirty: false,
      undoStack: [],
      redoStack: [],
    });
  },

  close: () => {
    set({
      isOpen: false,
      fixtureId: null,
      subtype: null,
      stagedParams: {},
      activeHandle: null,
      dirty: false,
      undoStack: [],
      redoStack: [],
    });
  },

  setView: (view) => set({ view }),
  setActiveHandle: (id) => set({ activeHandle: id }),

  updateParam: (key, value) => {
    set((s) => {
      const snapshot = { ...s.stagedParams };
      const undoStack = [...s.undoStack, snapshot].slice(-HISTORY_CAP);
      return {
        stagedParams: { ...s.stagedParams, [key]: value },
        undoStack,
        redoStack: [],
        dirty: true,
      };
    });
  },

  bulkUpdate: (patch) => {
    set((s) => {
      const snapshot = { ...s.stagedParams };
      const undoStack = [...s.undoStack, snapshot].slice(-HISTORY_CAP);
      return {
        stagedParams: { ...s.stagedParams, ...patch },
        undoStack,
        redoStack: [],
        dirty: true,
      };
    });
  },

  resetToDefaults: () => {
    const subtype = get().subtype;
    if (!subtype) return;
    set((s) => {
      const snapshot = { ...s.stagedParams };
      return {
        stagedParams: defaultParamsFor(subtype),
        undoStack: [...s.undoStack, snapshot].slice(-HISTORY_CAP),
        redoStack: [],
        dirty: true,
      };
    });
  },

  applyPreset: (preset) => {
    set((s) => {
      const snapshot = { ...s.stagedParams };
      return {
        stagedParams: { ...s.stagedParams, ...preset },
        undoStack: [...s.undoStack, snapshot].slice(-HISTORY_CAP),
        redoStack: [],
        dirty: true,
      };
    });
  },

  undo: () => {
    set((s) => {
      if (s.undoStack.length === 0) return s;
      const prev = s.undoStack[s.undoStack.length - 1]!;
      return {
        stagedParams: prev,
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, s.stagedParams].slice(-HISTORY_CAP),
        dirty: true,
      };
    });
  },

  redo: () => {
    set((s) => {
      if (s.redoStack.length === 0) return s;
      const next = s.redoStack[s.redoStack.length - 1]!;
      return {
        stagedParams: next,
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, s.stagedParams].slice(-HISTORY_CAP),
        dirty: true,
      };
    });
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  toggleRotationHandle: () => set((s) => ({ showRotationHandle: !s.showRotationHandle })),
  toggleSnapHalfInch:   () => set((s) => ({ snapHalfInch: !s.snapHalfInch })),
  toggleDimensions:     () => set((s) => ({ showDimensions: !s.showDimensions })),
  toggleWalls:          () => set((s) => ({ showWalls: !s.showWalls })),

  mirrorHorizontal: () => {
    // Swap cold ↔ hot supplies, faucet spread, etc.
    const p = get().stagedParams;
    const patch: Record<string, unknown> = {};
    if ('coldRoughIn' in p || 'hotRoughIn' in p) {
      patch.coldRoughIn = p.hotRoughIn ?? p.coldRoughIn;
      patch.hotRoughIn = p.coldRoughIn ?? p.hotRoughIn;
    }
    // Rotation mirrored across Z axis = 180 - rotation
    const rot = Number(p.rotationDeg ?? 0);
    patch.rotationDeg = ((180 - rot) % 360 + 360) % 360;
    get().bulkUpdate(patch);
  },

  flipDrainSide: () => {
    const p = get().stagedParams;
    if (p.drainSide) {
      const next = p.drainSide === 'left' ? 'right' : p.drainSide === 'right' ? 'left' : 'center';
      get().updateParam('drainSide', next);
    }
  },
}));
