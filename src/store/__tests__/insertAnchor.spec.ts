/**
 * pipeStore.insertAnchor + pipe.insertAnchor command — Phase 7.A tests.
 *
 * Every assertion corresponds to one invariant of the tee-from-middle
 * flow:
 *
 *   • A valid insertion grows the polyline by exactly one point.
 *   • Existing points are preserved in order (no rewrites).
 *   • Stale segmentIdx is rejected without mutating state.
 *   • Missing pipeId is rejected without mutating state.
 *   • Command handler snapshots the pre-insert points for undo.
 *   • Undo restores the pre-insert polyline byte-for-byte.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { usePipeStore } from '../pipeStore';
import { commandBus } from '@core/commands/CommandBus';
import { registerAllHandlers } from '@core/commands/handlers';
import type { Vec3 } from '@core/events';

function seedThreePointPipe(id = 'p1'): void {
  usePipeStore.setState({
    pipes: {
      [id]: {
        id,
        points: [
          [0, 0, 0],
          [5, 0, 0],
          [10, 0, 0],
        ] as Vec3[],
        diameter: 2,
        material: 'pvc_sch40',
        system: 'waste',
        color: '#ffa726',
        visible: true,
        selected: false,
      },
    },
    pipeOrder: [id],
    selectedId: null,
    undoStack: [],
    redoStack: [],
    pivotSession: null,
  });
}

beforeEach(() => {
  commandBus.__reset();
  registerAllHandlers();
  usePipeStore.setState({
    pipes: {}, pipeOrder: [], selectedId: null,
    undoStack: [], redoStack: [], pivotSession: null,
  });
});

// ── Direct store action ────────────────────────────────────────

describe('pipeStore.insertAnchor — direct action', () => {
  it('inserts a point in the middle of a 2-segment pipe at segment 0', () => {
    seedThreePointPipe();
    usePipeStore.getState().insertAnchor('p1', 0, [2.5, 0, 0]);

    const pts = usePipeStore.getState().pipes.p1!.points;
    expect(pts).toHaveLength(4);
    expect(pts[0]).toEqual([0, 0, 0]);
    expect(pts[1]).toEqual([2.5, 0, 0]); // the inserted vertex
    expect(pts[2]).toEqual([5, 0, 0]);
    expect(pts[3]).toEqual([10, 0, 0]);
  });

  it('inserts at segment 1 (the second segment of a 2-segment pipe)', () => {
    seedThreePointPipe();
    usePipeStore.getState().insertAnchor('p1', 1, [7.5, 0, 0]);

    const pts = usePipeStore.getState().pipes.p1!.points;
    expect(pts).toHaveLength(4);
    expect(pts[2]).toEqual([7.5, 0, 0]);
  });

  it('is a no-op for missing pipeId', () => {
    seedThreePointPipe();
    const before = JSON.stringify(usePipeStore.getState().pipes);
    usePipeStore.getState().insertAnchor('nope', 0, [1, 2, 3]);
    expect(JSON.stringify(usePipeStore.getState().pipes)).toBe(before);
  });

  it('is a no-op for out-of-range segmentIdx', () => {
    seedThreePointPipe();
    const before = JSON.stringify(usePipeStore.getState().pipes);
    usePipeStore.getState().insertAnchor('p1', 99, [1, 2, 3]);
    expect(JSON.stringify(usePipeStore.getState().pipes)).toBe(before);
    usePipeStore.getState().insertAnchor('p1', -1, [1, 2, 3]);
    expect(JSON.stringify(usePipeStore.getState().pipes)).toBe(before);
  });
});

// ── Command handler ────────────────────────────────────────────

describe('pipe.insertAnchor command handler', () => {
  it('happy path: dispatch succeeds and mutates pipeStore', () => {
    seedThreePointPipe();
    const res = commandBus.dispatch({
      type: 'pipe.insertAnchor',
      payload: { pipeId: 'p1', segmentIdx: 0, position: [2.5, 0, 0] as Vec3 },
    });
    expect(res.ok).toBe(true);
    expect(usePipeStore.getState().pipes.p1!.points).toHaveLength(4);
  });

  it('rejects missing pipe without mutating', () => {
    const res = commandBus.dispatch({
      type: 'pipe.insertAnchor',
      payload: { pipeId: 'nope', segmentIdx: 0, position: [0, 0, 0] as Vec3 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/no pipe/);
  });

  it('rejects out-of-range segmentIdx without mutating', () => {
    seedThreePointPipe();
    const res = commandBus.dispatch({
      type: 'pipe.insertAnchor',
      payload: { pipeId: 'p1', segmentIdx: 5, position: [0, 0, 0] as Vec3 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/out of range/);
    expect(usePipeStore.getState().pipes.p1!.points).toHaveLength(3);
  });

  it('snapshot captures pre-insert points (verified via undo)', async () => {
    seedThreePointPipe();
    const originalPoints: Vec3[] = [
      [0, 0, 0], [5, 0, 0], [10, 0, 0],
    ];

    const res = commandBus.dispatch({
      type: 'pipe.insertAnchor',
      payload: { pipeId: 'p1', segmentIdx: 0, position: [2.5, 0, 0] as Vec3 },
    });
    expect(res.ok).toBe(true);
    expect(usePipeStore.getState().pipes.p1!.points).toHaveLength(4);

    // Simulate undo via the handler's undo() directly — the command bus
    // dispatch(issuedBy: 'undo') path re-invokes the handler with the
    // snapshot. We test undo in isolation since there's no
    // higher-level undo manager yet.
    const pipeInsertHandler = (await import('@core/commands/handlers/pipeHandlers')).pipeInsertAnchorHandler;
    pipeInsertHandler.undo!(
      { pipeId: 'p1', segmentIdx: 0, position: [2.5, 0, 0] as Vec3 },
      (res as { snapshot: unknown }).snapshot,
      { childCorrelation: () => 'x', currentCommand: res.command as any },
    );

    expect(usePipeStore.getState().pipes.p1!.points).toEqual(originalPoints);
  });
});
