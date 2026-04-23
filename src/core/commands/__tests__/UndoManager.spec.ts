/**
 * UndoManager — Phase 8.B tests.
 *
 * Covers:
 *   • Single undo reverses the last undoable command.
 *   • Redo re-applies it in-place.
 *   • New user command after undo truncates the redo region.
 *   • Non-undoable commands (e.g. interaction.setMode) are skipped
 *     by the walker.
 *   • canUndo/canRedo gate correctly.
 *   • Undo through multiple command types (pipe.add → pipe.insertAnchor → undo × 2).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { commandBus } from '../CommandBus';
import { registerAllHandlers } from '../handlers';
import {
  undo, redo, canUndo, canRedo, getUndoDepth,
  installUndoHook, __resetUndoManagerForTests,
} from '../UndoManager';
import { usePipeStore } from '@store/pipeStore';
import type { PipeAddPayload } from '../handlers/pipeHandlers';
import type { Vec3 } from '@core/events';

function addPipe(id: string): PipeAddPayload {
  return {
    id,
    points: [[0, 0, 0], [1, 0, 0]],
    diameter: 2,
    material: 'pvc_sch40',
  };
}

beforeEach(() => {
  commandBus.__reset();
  registerAllHandlers();
  __resetUndoManagerForTests();
  installUndoHook();
  usePipeStore.setState({
    pipes: {}, pipeOrder: [], selectedId: null,
    undoStack: [], redoStack: [], pivotSession: null,
  });
});

// ── canUndo / canRedo gates ────────────────────────────────────

describe('UndoManager — gates', () => {
  it('fresh bus: canUndo=false, canRedo=false', () => {
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
  });

  it('after one undoable command: canUndo=true, canRedo=false', () => {
    commandBus.dispatch({ type: 'pipe.add', payload: addPipe('a') });
    expect(canUndo()).toBe(true);
    expect(canRedo()).toBe(false);
  });

  it('after undo: canUndo depends on remaining, canRedo=true', () => {
    commandBus.dispatch({ type: 'pipe.add', payload: addPipe('a') });
    commandBus.dispatch({ type: 'pipe.remove', payload: { id: 'a' } });
    expect(undo()).not.toBeNull();
    expect(canRedo()).toBe(true);
  });
});

// ── Single undo / redo ────────────────────────────────────────

describe('UndoManager — single undo/redo cycle', () => {
  it('undo pipe.remove restores the pipe; redo removes it again', () => {
    commandBus.dispatch({ type: 'pipe.add', payload: addPipe('a') });
    commandBus.dispatch({ type: 'pipe.remove', payload: { id: 'a' } });
    expect(usePipeStore.getState().pipes.a).toBeUndefined();

    const result = undo();
    expect(result).toBe('pipe.remove');
    expect(usePipeStore.getState().pipes.a).toBeDefined();
    expect(getUndoDepth()).toBe(1);

    const redoResult = redo();
    expect(redoResult).toBe('pipe.remove');
    expect(usePipeStore.getState().pipes.a).toBeUndefined();
    expect(getUndoDepth()).toBe(0);
  });

  it('undo insertAnchor restores the polyline byte-exact', () => {
    commandBus.dispatch({ type: 'pipe.add', payload: {
      id: 'p1',
      points: [[0, 0, 0], [5, 0, 0], [10, 0, 0]] as Vec3[],
      diameter: 2,
      material: 'pvc_sch40',
    } });
    commandBus.dispatch({
      type: 'pipe.insertAnchor',
      payload: { pipeId: 'p1', segmentIdx: 0, position: [2.5, 0, 0] as Vec3 },
    });
    expect(usePipeStore.getState().pipes.p1!.points).toHaveLength(4);

    undo();

    expect(usePipeStore.getState().pipes.p1!.points).toHaveLength(3);
    expect(usePipeStore.getState().pipes.p1!.points).toEqual([
      [0, 0, 0], [5, 0, 0], [10, 0, 0],
    ]);
  });
});

// ── Redo truncation ───────────────────────────────────────────

describe('UndoManager — redo truncation', () => {
  it('new user command after undo clears the redo region', () => {
    commandBus.dispatch({ type: 'pipe.add', payload: addPipe('a') });
    commandBus.dispatch({ type: 'pipe.remove', payload: { id: 'a' } });
    undo(); // pipe.remove undone; canRedo=true
    expect(canRedo()).toBe(true);

    // User adds a new pipe — redo region vanishes.
    commandBus.dispatch({ type: 'pipe.add', payload: addPipe('b') });
    expect(canRedo()).toBe(false);
  });
});

// ── Non-undoable commands ─────────────────────────────────────

describe('UndoManager — skips non-undoable', () => {
  it('interaction.setMode is skipped by the walker (no snapshot)', () => {
    // setMode has no snapshot() handler => not undoable.
    commandBus.dispatch({ type: 'interaction.setMode', payload: { mode: 'navigate' } });
    expect(canUndo()).toBe(false);
    expect(undo()).toBeNull();
  });

  it('a mix of undoable and non-undoable: undo only walks undoable', () => {
    commandBus.dispatch({ type: 'interaction.setMode', payload: { mode: 'select' } });
    commandBus.dispatch({ type: 'pipe.add', payload: addPipe('a') });
    commandBus.dispatch({ type: 'interaction.setMode', payload: { mode: 'navigate' } });
    commandBus.dispatch({ type: 'pipe.remove', payload: { id: 'a' } });

    // Both pipe.add and pipe.remove are undoable; setMode is not.
    expect(undo()).toBe('pipe.remove');
    expect(undo()).toBe('pipe.add');
    expect(undo()).toBeNull(); // no more undoable commands
  });
});

// ── Multi-step chain ──────────────────────────────────────────

describe('UndoManager — multi-step chain', () => {
  it('two pipe.add commands in a row: undo twice removes both', () => {
    commandBus.dispatch({ type: 'pipe.add', payload: addPipe('a') });
    commandBus.dispatch({ type: 'pipe.add', payload: addPipe('b') });

    expect(usePipeStore.getState().pipes.a).toBeDefined();
    expect(usePipeStore.getState().pipes.b).toBeDefined();

    // Undo reverses pipe.add by removing the pipe.
    expect(undo()).toBe('pipe.add'); // most recent = 'b'
    expect(usePipeStore.getState().pipes.b).toBeUndefined();
    expect(usePipeStore.getState().pipes.a).toBeDefined();

    expect(undo()).toBe('pipe.add'); // now 'a'
    expect(usePipeStore.getState().pipes.a).toBeUndefined();

    expect(getUndoDepth()).toBe(2);
  });
});

// ── Manifold merge ────────────────────────────────────────────

describe('UndoManager — manifold.mergeNeighbors round-trip', () => {
  it('merging two manifolds and undoing restores both originals', async () => {
    const { useManifoldStore } = await import('@store/manifoldStore');
    useManifoldStore.setState({ manifolds: {}, order: [], selectedId: null });

    // Two adjacent 2-port manifolds that will merge on neighbor check.
    commandBus.dispatch({
      type: 'manifold.add',
      payload: {
        position: [0, 0, 0], yawRad: 0, portCount: 2,
        system: 'cold_supply', material: 'pex',
        portDiameterIn: 0.5, floorY: 0,
      },
    });
    const id1 = Object.keys(useManifoldStore.getState().manifolds)[0]!;

    commandBus.dispatch({
      type: 'manifold.add',
      payload: {
        position: [0.5, 0, 0], yawRad: 0, portCount: 2,
        system: 'cold_supply', material: 'pex',
        portDiameterIn: 0.5, floorY: 0,
      },
    });
    expect(Object.keys(useManifoldStore.getState().manifolds)).toHaveLength(2);

    // Merge attempt.
    commandBus.dispatch({
      type: 'manifold.mergeNeighbors',
      payload: { id: id1 },
    });
    expect(Object.keys(useManifoldStore.getState().manifolds)).toHaveLength(1);
    expect(useManifoldStore.getState().manifolds[id1]!.portCount).toBe(4);

    // Undo — both originals should return, combined 4-port should vanish.
    const result = undo();
    expect(result).toBe('manifold.mergeNeighbors');
    expect(Object.keys(useManifoldStore.getState().manifolds)).toHaveLength(2);

    useManifoldStore.setState({ manifolds: {}, order: [], selectedId: null });
  });
});
