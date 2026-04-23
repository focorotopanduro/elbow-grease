/**
 * pipeCollisionScenarios — Phase 14.X
 *
 * End-to-end scenario coverage for pipe-pipe collision detection +
 * visualization in the presence of real store state.
 *
 * Each test builds a populated pipeStore, asks the detector, and
 * asserts both the detection result AND that legal junctions stay
 * clean.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { usePipeStore } from '../../store/pipeStore';
import { detectPipePipeCollisions, summarizePipeCollisions } from '../../core/interference/pipeCollision';

function resetPipes() {
  usePipeStore.setState({
    pipes: {}, pipeOrder: [], selectedId: null,
    undoStack: [], redoStack: [], pivotSession: null,
  });
}

function addRawPipe(id: string, points: [number, number, number][], diameter = 2): void {
  const store = usePipeStore.getState();
  store.addPipe({ id, points, diameter, material: 'pvc_sch40' });
}

describe('Scenario — pipe-pipe collision scenarios', () => {
  beforeEach(resetPipes);

  it('two parallel pipes at ample distance: no markers', () => {
    addRawPipe('a', [[0, 0, 0], [10, 0, 0]]);
    addRawPipe('b', [[0, 0, 5], [10, 0, 5]]);
    const pipes = Object.values(usePipeStore.getState().pipes);
    expect(detectPipePipeCollisions(pipes)).toEqual([]);
  });

  it('perpendicular X-Z cross at same Y: flagged as clip', () => {
    addRawPipe('a', [[0, 0, 0], [10, 0, 0]]);
    addRawPipe('b', [[5, 0, -5], [5, 0, 5]]);
    const pipes = Object.values(usePipeStore.getState().pipes);
    const cols = detectPipePipeCollisions(pipes);
    expect(cols.length).toBeGreaterThanOrEqual(1);
    expect(cols[0]!.severity).toBe('clip');
  });

  it('pipes jogged apart by 3 ft in Y: no collision', () => {
    addRawPipe('a', [[0, 0, 0], [10, 0, 0]]);
    addRawPipe('b', [[5, 3, -5], [5, 3, 5]]);
    const pipes = Object.values(usePipeStore.getState().pipes);
    expect(detectPipePipeCollisions(pipes)).toEqual([]);
  });

  it('shared endpoint (legal tee): no collision flag', () => {
    addRawPipe('main', [[0, 0, 0], [10, 0, 0]]);
    addRawPipe('branch', [[5, 0, 0], [5, 0, 5]]);
    // Phase 14.AD.20 made endpoint-on-segment-interior a LEGAL
    // junction (treated as a mid-pipe tee). `segmentsShareJunction`
    // in pipeCollision now skips these the same way it skips
    // endpoint-to-endpoint sharing. Branch endpoint (5,0,0) falling
    // on `main`'s mid-segment is no longer a collision — the
    // fitting emitter auto-generates the correct tee/wye/combo
    // there. Test renamed + flipped to match AD.20 semantics.
    const pipes = Object.values(usePipeStore.getState().pipes);
    const cols = detectPipePipeCollisions(pipes);
    expect(cols).toEqual([]);
  });

  it('proper 3-pipe tee (endpoint-shared): no collisions', () => {
    // Split the main into two halves meeting at (5,0,0)
    addRawPipe('mainA', [[0, 0, 0], [5, 0, 0]]);
    addRawPipe('mainB', [[5, 0, 0], [10, 0, 0]]);
    addRawPipe('branch', [[5, 0, 0], [5, 0, 5]]);
    const pipes = Object.values(usePipeStore.getState().pipes);
    expect(detectPipePipeCollisions(pipes)).toEqual([]);
  });

  it('near-parallel hugging pipes: multiple collisions', () => {
    // Two parallel 10-ft runs 0.15 ft apart — both 2" PVC means they clip
    addRawPipe('a', [[0, 0, 0], [10, 0, 0]]);
    addRawPipe('b', [[0, 0, 0.15], [10, 0, 0.15]]);
    const pipes = Object.values(usePipeStore.getState().pipes);
    const cols = detectPipePipeCollisions(pipes);
    expect(cols.length).toBeGreaterThanOrEqual(1);
    const summary = summarizePipeCollisions(cols);
    expect(summary.clip + summary.overlap).toBeGreaterThanOrEqual(1);
  });

  it('invisible pipe: its collisions are suppressed', () => {
    addRawPipe('a', [[0, 0, 0], [10, 0, 0]]);
    addRawPipe('b', [[5, 0, -5], [5, 0, 5]]);
    // Hide pipe b
    usePipeStore.getState().setVisibility('b', false);
    const pipes = Object.values(usePipeStore.getState().pipes);
    expect(detectPipePipeCollisions(pipes)).toEqual([]);
  });

  it('50-pipe dense scene: detector returns in < 100ms', () => {
    for (let i = 0; i < 50; i++) {
      addRawPipe(
        `p${i}`,
        [[0, 0, i * 0.5], [10, 0, i * 0.5]],
      );
    }
    const pipes = Object.values(usePipeStore.getState().pipes);
    const t0 = performance.now();
    detectPipePipeCollisions(pipes);
    expect(performance.now() - t0).toBeLessThan(100);
  });
});
