/**
 * Integration: pipe drawing flow.
 *
 * Exercises the wiring from EventBus → pipeStore subscription →
 * store mutation. If someone refactors the event name or the
 * subscription shape, this test catches it at a level no unit test
 * would (because unit tests stub the EventBus).
 *
 * What's NOT tested here:
 *   • Web Worker solver. The SimulationBridge uses a worker in prod;
 *     the integration harness runs against the main-thread fallback.
 *   • UI rendering. This is a data-path test, not a visual one.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { usePipeStore } from '@store/pipeStore';
import { useFeatureFlagStore } from '@store/featureFlagStore';
import { resetAllStores, bootEventWiring, emit } from './harness';
import { EV, type PipeCompletePayload } from '@core/events';

beforeAll(() => {
  bootEventWiring();
});

beforeEach(() => {
  resetAllStores();
  // These tests exercise the direct-subscription path — make sure the
  // CommandBus flag is OFF so the pipeStore subscribes directly to
  // EV.PIPE_COMPLETE.
  useFeatureFlagStore.setState({ commandBus: false });
});

describe('EV.PIPE_COMPLETE → pipeStore', () => {
  it('a single committed route becomes a CommittedPipe', () => {
    expect(Object.keys(usePipeStore.getState().pipes)).toHaveLength(0);

    const payload: PipeCompletePayload = {
      id: 'route-1',
      points: [[0, 0, 0], [5, 0, 0], [5, 0, 5]],
      diameter: 2,
      material: 'pvc_sch40',
    };
    emit(EV.PIPE_COMPLETE, payload);

    const pipes = usePipeStore.getState().pipes;
    expect(Object.keys(pipes)).toHaveLength(1);
    const p = pipes['route-1'];
    expect(p).toBeDefined();
    expect(p!.points).toHaveLength(3);
    expect(p!.diameter).toBe(2);
    expect(p!.material).toBe('pvc_sch40');
    // Color is derived from diameter by the store.
    expect(p!.color).toBe('#ffa726');
  });

  it('a second route with a different id appends, does not replace', () => {
    emit<PipeCompletePayload>(EV.PIPE_COMPLETE, {
      id: 'r1', points: [[0, 0, 0], [1, 0, 0]], diameter: 1, material: 'pex',
    });
    emit<PipeCompletePayload>(EV.PIPE_COMPLETE, {
      id: 'r2', points: [[2, 0, 0], [3, 0, 0]], diameter: 3, material: 'pvc_sch40',
    });
    const s = usePipeStore.getState();
    expect(Object.keys(s.pipes)).toEqual(expect.arrayContaining(['r1', 'r2']));
    expect(s.pipeOrder).toEqual(['r1', 'r2']);
  });

  it('CommandBus flag ON → direct subscription is SKIPPED (no double-add)', () => {
    useFeatureFlagStore.setState({ commandBus: true });

    emit<PipeCompletePayload>(EV.PIPE_COMPLETE, {
      id: 'direct', points: [[0, 0, 0], [1, 0, 0]], diameter: 2, material: 'pex',
    });

    // With commandBus ON, the direct subscription in pipeStore bails out.
    // The CommandBus path would normally dispatch pipe.add via the
    // EventToCommand translator, but that's a separate wiring not booted
    // here. So the pipe should NOT land via this path.
    expect(usePipeStore.getState().pipes['direct']).toBeUndefined();
  });
});

describe('undo stack integrity', () => {
  it('adding then removing a pipe pushes the matching commands', () => {
    usePipeStore.getState().addPipe({
      id: 'p1', points: [[0, 0, 0], [1, 0, 0]], diameter: 2, material: 'pex',
    });
    expect(usePipeStore.getState().undoStack).toHaveLength(1);
    expect(usePipeStore.getState().undoStack[0]!.type).toBe('add');

    usePipeStore.getState().removePipe('p1');
    expect(usePipeStore.getState().undoStack).toHaveLength(2);
    expect(usePipeStore.getState().undoStack[1]!.type).toBe('remove');
  });
});
