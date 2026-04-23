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
// Phase 3 — per-mode undo partitioning requires controlling the
// active workspace in tests.
import { useAppModeStore } from '@store/appModeStore';
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

// ── Phase 3 — per-mode undo semantics (ARCHITECTURE.md §4.3) ──
//
// The three scenarios below are the exact coverage the spec
// mandates. They use SYNTHETIC handlers tagged with different
// `mode` values rather than the real pipe/section/pricing
// surfaces (roofing isn't on the CommandBus yet, and pricing
// edits still go straight to the store). What's under test is
// the UndoManager's partitioning logic: given mode-stamped log
// entries, does it walk the right subset?

describe('UndoManager — per-mode partitioning (ARCHITECTURE.md §4.3)', () => {
  // Minimal per-domain "stores" — plain records the synthetic
  // handlers mutate in place.
  const pipes: Record<string, { id: string }> = {};
  const sections: Record<string, { id: string }> = {};
  const pricing: { rate: number } = { rate: 0 };

  function registerPhase3TestHandlers() {
    // Plumbing-scoped: add/remove a pipe.
    commandBus.register<{ id: string }, void>({
      type: 'test.pipe.add',
      mode: 'plumbing',
      snapshot: (p) => ({ prev: pipes[p.id] }),
      apply: (p) => { pipes[p.id] = { id: p.id }; },
      undo: (p, snap) => {
        const s = snap as { prev: { id: string } | undefined };
        if (s.prev === undefined) delete pipes[p.id];
        else pipes[p.id] = s.prev;
      },
    });

    // Roofing-scoped: add/remove a section.
    commandBus.register<{ id: string }, void>({
      type: 'test.section.add',
      mode: 'roofing',
      snapshot: (p) => ({ prev: sections[p.id] }),
      apply: (p) => { sections[p.id] = { id: p.id }; },
      undo: (p, snap) => {
        const s = snap as { prev: { id: string } | undefined };
        if (s.prev === undefined) delete sections[p.id];
        else sections[p.id] = s.prev;
      },
    });

    // Shared: pricing edit. Participates in BOTH workspaces'
    // undo stacks regardless of which mode was active at
    // dispatch.
    commandBus.register<{ rate: number }, void>({
      type: 'test.pricing.edit',
      mode: 'shared',
      snapshot: () => ({ prev: pricing.rate }),
      apply: (p) => { pricing.rate = p.rate; },
      undo: (_p, snap) => {
        const s = snap as { prev: number };
        pricing.rate = s.prev;
      },
    });
  }

  beforeEach(() => {
    // beforeEach at file top resets commandBus + re-registers the
    // real handlers + reinstalls the undo hook. Now register our
    // synthetic ones on top + wipe the fake stores.
    registerPhase3TestHandlers();
    for (const k of Object.keys(pipes)) delete pipes[k];
    for (const k of Object.keys(sections)) delete sections[k];
    pricing.rate = 0;
    useAppModeStore.setState({ mode: 'plumbing' });
  });

  it('scenario (a): draw pipe → switch to roofing → Ctrl+Z is a no-op', () => {
    // Plumbing: dispatch a pipe.
    commandBus.dispatch({ type: 'test.pipe.add', payload: { id: 'p1' } });
    expect(pipes.p1).toBeDefined();

    // Switch workspace.
    useAppModeStore.setState({ mode: 'roofing' });

    // Ctrl+Z in roofing must not touch the plumbing-scoped entry.
    expect(canUndo()).toBe(false);
    expect(undo()).toBeNull();
    expect(pipes.p1).toBeDefined();
  });

  it('scenario (b): pipe → switch → section → Ctrl+Z removes section; Ctrl+Z no-op; switch back → Ctrl+Z removes pipe', () => {
    // Plumbing: pipe.
    commandBus.dispatch({ type: 'test.pipe.add', payload: { id: 'p1' } });

    // Switch to roofing, section.
    useAppModeStore.setState({ mode: 'roofing' });
    commandBus.dispatch({ type: 'test.section.add', payload: { id: 's1' } });

    expect(pipes.p1).toBeDefined();
    expect(sections.s1).toBeDefined();

    // In roofing: undo → section removed.
    expect(canUndo()).toBe(true);
    expect(undo()).toBe('test.section.add');
    expect(sections.s1).toBeUndefined();
    expect(pipes.p1).toBeDefined();

    // Another Ctrl+Z in roofing has nothing eligible — the pipe
    // is plumbing-scoped.
    expect(canUndo()).toBe(false);
    expect(undo()).toBeNull();

    // Switch back to plumbing; pipe becomes the eligible target.
    useAppModeStore.setState({ mode: 'plumbing' });
    expect(canUndo()).toBe(true);
    expect(undo()).toBe('test.pipe.add');
    expect(pipes.p1).toBeUndefined();
  });

  it('scenario (c): edit pricing in plumbing → switch to roofing → Ctrl+Z reverts the pricing edit', () => {
    // Plumbing: edit pricing.
    commandBus.dispatch({ type: 'test.pricing.edit', payload: { rate: 120 } });
    expect(pricing.rate).toBe(120);

    // Switch workspace.
    useAppModeStore.setState({ mode: 'roofing' });

    // Shared entry must appear in BOTH stacks — undoable from
    // either side.
    expect(canUndo()).toBe(true);
    expect(undo()).toBe('test.pricing.edit');
    expect(pricing.rate).toBe(0);
  });

  it('shared command undone from one side is undone for the other too', () => {
    // Dispatch a shared command, undo it in roofing, switch back
    // and verify plumbing does NOT see it as undoable again.
    commandBus.dispatch({ type: 'test.pricing.edit', payload: { rate: 200 } });

    useAppModeStore.setState({ mode: 'roofing' });
    expect(undo()).toBe('test.pricing.edit');

    useAppModeStore.setState({ mode: 'plumbing' });
    // canUndo may still be false — the shared command is in the
    // undone set and there are no OTHER undoable plumbing entries.
    expect(canUndo()).toBe(false);
    // But redo works in plumbing (also shared).
    expect(canRedo()).toBe(true);
    expect(redo()).toBe('test.pricing.edit');
    expect(pricing.rate).toBe(200);
  });

  it('redo dispatched from a different mode than undo still re-applies the shared command', () => {
    commandBus.dispatch({ type: 'test.pricing.edit', payload: { rate: 50 } });

    // Undo in plumbing.
    useAppModeStore.setState({ mode: 'plumbing' });
    undo();
    expect(pricing.rate).toBe(0);

    // Redo in roofing — still allowed because the entry is shared.
    useAppModeStore.setState({ mode: 'roofing' });
    expect(canRedo()).toBe(true);
    expect(redo()).toBe('test.pricing.edit');
    expect(pricing.rate).toBe(50);
  });

  it('a new user command clears the redo region across both modes', () => {
    commandBus.dispatch({ type: 'test.pricing.edit', payload: { rate: 75 } });
    undo();
    expect(canRedo()).toBe(true);

    // Any new user command, in any mode, truncates redo.
    commandBus.dispatch({ type: 'test.pipe.add', payload: { id: 'p-new' } });
    expect(canRedo()).toBe(false);

    // Even switching to roofing doesn't bring the redo back.
    useAppModeStore.setState({ mode: 'roofing' });
    expect(canRedo()).toBe(false);
  });
});
