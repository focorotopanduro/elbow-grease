/**
 * Pipe command handlers.
 *
 * Each handler wraps a single pipeStore mutation behind the bus so that
 *   1. The mutation can be replayed deterministically from the log.
 *   2. Preconditions (FSM state, existence checks) run uniformly.
 *   3. Snapshots for undo are captured in one place per action.
 *
 * This file does NOT yet replace pipeStore's internal mutations —
 * during Phase 1 rollout both paths coexist behind the `commandBus`
 * feature flag (see registry.ts). Once every call site uses dispatch,
 * the direct setters become private.
 */

import type { CommandHandler } from '../types';
import { usePipeStore, type CommittedPipe } from '@store/pipeStore';
// Phase 7.D.ii — undo of pipe.remove must also clean up any auto-cap
// that the ConnectivityManager pushed as a side effect.
import { useCappedEndpointStore } from '@store/cappedEndpointStore';
import { usePipeConnectivityStore } from '@store/pipeConnectivityStore';
import type { Vec3 } from '@core/events';

// ── Payload shapes (exported so call sites get typechecking) ──

export interface PipeAddPayload {
  id: string;
  points: Vec3[];
  diameter: number;
  material: string;
}

export interface PipeRemovePayload {
  id: string;
}

export interface PipeSelectPayload {
  id: string | null;
}

export interface PipeUpdateDiameterPayload {
  id: string;
  diameter: number;
}

export interface PipeBeginPivotPayload {
  pipeId: string;
  grabbedEnd: 'start' | 'end';
}

export interface PipeCommitPivotPayload {
  finalPoints: Vec3[];
}

export interface PipeCancelPivotPayload {
  reason?: string;
}

/**
 * Phase 7.A — insert a new vertex into an existing pipe's polyline.
 * Used by the tee-from-middle-drag flow.
 */
export interface PipeInsertAnchorPayload {
  pipeId: string;
  /** Segment index where the anchor is inserted (0-based). The new
   *  point becomes points[segmentIdx + 1]. */
  segmentIdx: number;
  position: Vec3;
}

// ── Handlers ───────────────────────────────────────────────────

/**
 * pipe.add — commit a route that finished drawing.
 *
 * Precondition: points.length >= 2, no pipe with this id already exists
 * (stale `PIPE_COMPLETE` firing twice is a real race we've seen).
 */
export const pipeAddHandler: CommandHandler<PipeAddPayload, CommittedPipe> = {
  type: 'pipe.add',
  preconditions: (p) => {
    if (!Array.isArray(p.points) || p.points.length < 2) {
      return 'pipe.add requires at least 2 points';
    }
    if (usePipeStore.getState().pipes[p.id]) {
      return `Pipe "${p.id}" already exists (duplicate PIPE_COMPLETE?)`;
    }
    if (!(p.diameter > 0)) {
      return `pipe.add diameter must be > 0 (got ${p.diameter})`;
    }
    return null;
  },
  snapshot: () => null, // add is undone by remove — nothing to snapshot
  apply: (p) => {
    usePipeStore.getState().addPipe({
      id: p.id,
      points: p.points,
      diameter: p.diameter,
      material: p.material,
    });
    return usePipeStore.getState().pipes[p.id];
  },
  undo: (p) => {
    // Undo of add = remove. Does not re-snapshot (there was nothing to save).
    usePipeStore.getState().removePipe(p.id);
  },
};

/**
 * pipe.remove — delete a committed pipe.
 * Snapshot captures the full pipe record for undo-restore.
 */
export const pipeRemoveHandler: CommandHandler<PipeRemovePayload, void> = {
  type: 'pipe.remove',
  preconditions: (p) => {
    if (!usePipeStore.getState().pipes[p.id]) {
      return `pipe.remove: no pipe with id "${p.id}"`;
    }
    return null;
  },
  snapshot: (p) => usePipeStore.getState().pipes[p.id] ?? null,
  apply: (p) => {
    usePipeStore.getState().removePipe(p.id);
  },
  undo: (_p, snapshot) => {
    const pipe = snapshot as CommittedPipe | null;
    if (!pipe) return;

    // 1. Restore the pipe itself.
    usePipeStore.getState().addPipe({
      id: pipe.id,
      points: pipe.points,
      diameter: pipe.diameter,
      material: pipe.material,
    });

    // 2. Phase 7.D.ii — reverse side effects of the original remove:
    //    a. ConnectivityManager pushed a cap at each orphaned endpoint.
    //       Clear caps at both endpoints (idempotent; if no cap, no-op).
    //    b. ConnectivityManager unindexed the pipe. Re-index so future
    //       removes can detect its neighbors again. addPipe() doesn't
    //       flow through the CommandBus when called directly, so we
    //       must poke the connectivity store ourselves.
    const caps = useCappedEndpointStore.getState();
    const first = pipe.points[0];
    const last = pipe.points[pipe.points.length - 1];
    if (first) caps.removeCapAt(first);
    if (last) caps.removeCapAt(last);
    usePipeConnectivityStore.getState().indexPipe(pipe.id, pipe.points);
  },
};

/**
 * pipe.select — set or clear the selected pipe.
 * No undo (selection is UI state, not model state).
 */
export const pipeSelectHandler: CommandHandler<PipeSelectPayload, void> = {
  type: 'pipe.select',
  preconditions: (p) => {
    if (p.id !== null && !usePipeStore.getState().pipes[p.id]) {
      return `pipe.select: no pipe with id "${p.id}"`;
    }
    return null;
  },
  apply: (p) => {
    usePipeStore.getState().selectPipe(p.id);
  },
};

/**
 * pipe.updateDiameter — emitted by the solver when pipes get resized.
 * Snapshots prior diameter so a user can "undo the solver's choice".
 */
export const pipeUpdateDiameterHandler: CommandHandler<
  PipeUpdateDiameterPayload,
  void
> = {
  type: 'pipe.updateDiameter',
  preconditions: (p) => {
    if (!usePipeStore.getState().pipes[p.id]) {
      return `pipe.updateDiameter: no pipe with id "${p.id}"`;
    }
    if (!(p.diameter > 0)) {
      return `pipe.updateDiameter: diameter must be > 0 (got ${p.diameter})`;
    }
    return null;
  },
  snapshot: (p) => ({
    diameter: usePipeStore.getState().pipes[p.id]?.diameter,
  }),
  apply: (p) => {
    usePipeStore.getState().updateDiameter(p.id, p.diameter);
  },
  undo: (p, snapshot) => {
    const prev = (snapshot as { diameter?: number }).diameter;
    if (typeof prev === 'number') {
      usePipeStore.getState().updateDiameter(p.id, prev);
    }
  },
};

/**
 * pipe.beginPivot / pipe.commitPivot / pipe.cancelPivot — mirror the
 * existing pivot session API. Snapshot of begin lets undo cancel
 * safely.
 */
export const pipeBeginPivotHandler: CommandHandler<PipeBeginPivotPayload, void> = {
  type: 'pipe.beginPivot',
  preconditions: (p) => {
    if (!usePipeStore.getState().pipes[p.pipeId]) {
      return `pipe.beginPivot: no pipe "${p.pipeId}"`;
    }
    if (usePipeStore.getState().pivotSession) {
      return 'pipe.beginPivot: another pivot already in progress';
    }
    return null;
  },
  apply: (p) => {
    usePipeStore.getState().beginPivot(p.pipeId, p.grabbedEnd);
  },
};

export const pipeCommitPivotHandler: CommandHandler<PipeCommitPivotPayload, void> = {
  type: 'pipe.commitPivot',
  preconditions: () => {
    if (!usePipeStore.getState().pivotSession) {
      return 'pipe.commitPivot: no pivot session active';
    }
    return null;
  },
  apply: (p) => {
    usePipeStore.getState().commitPivot(p.finalPoints);
  },
};

export const pipeCancelPivotHandler: CommandHandler<PipeCancelPivotPayload, void> = {
  type: 'pipe.cancelPivot',
  preconditions: () => {
    if (!usePipeStore.getState().pivotSession) {
      return 'pipe.cancelPivot: no pivot session active';
    }
    return null;
  },
  apply: () => {
    usePipeStore.getState().cancelPivot();
  },
};

/**
 * pipe.insertAnchor — the Phase 7.A tee insertion.
 *
 * Snapshot captures the pre-insert points array so undo can restore
 * the original polyline byte-for-byte. Precondition rejects stale
 * calls (pipe deleted, segmentIdx out of range).
 */
export const pipeInsertAnchorHandler: CommandHandler<PipeInsertAnchorPayload, void> = {
  type: 'pipe.insertAnchor',
  preconditions: (p) => {
    const pipe = usePipeStore.getState().pipes[p.pipeId];
    if (!pipe) return `pipe.insertAnchor: no pipe "${p.pipeId}"`;
    if (p.segmentIdx < 0 || p.segmentIdx >= pipe.points.length - 1) {
      return `pipe.insertAnchor: segmentIdx ${p.segmentIdx} out of range (0..${pipe.points.length - 2})`;
    }
    return null;
  },
  snapshot: (p) => {
    // Full deep-copy of points so undo restores the exact pre-insert state.
    const pipe = usePipeStore.getState().pipes[p.pipeId];
    return pipe ? { points: pipe.points.map((pt) => [...pt] as Vec3) } : null;
  },
  apply: (p) => {
    usePipeStore.getState().insertAnchor(p.pipeId, p.segmentIdx, p.position);
  },
  undo: (p, snap) => {
    const s = snap as { points: Vec3[] } | null;
    if (!s) return;
    // Rewrite the pipe's points directly — the only safe way to
    // reverse an insertion without knowing downstream mutations.
    usePipeStore.setState((state) => {
      const pipe = state.pipes[p.pipeId];
      if (!pipe) return state;
      return {
        pipes: {
          ...state.pipes,
          [p.pipeId]: { ...pipe, points: s.points },
        },
      };
    });
  },
};

export const pipeHandlers = [
  pipeAddHandler,
  pipeRemoveHandler,
  pipeSelectHandler,
  pipeUpdateDiameterHandler,
  pipeBeginPivotHandler,
  pipeCommitPivotHandler,
  pipeCancelPivotHandler,
  pipeInsertAnchorHandler,
] as const;
