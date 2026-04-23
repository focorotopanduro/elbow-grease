/**
 * PerfStats — Phase 14.AC.4 pipe-loop telemetry tests.
 *
 * Isolates the new counters added for the pipe hot path:
 *   • segment-extract cache hits / misses / calls
 *   • batch-mutation size
 *   • rAF-event emissions received vs invocations fired
 *
 * Each test uses the shared singleton state — `reset()` is called
 * via `beforeEach` to start clean. Tests never run in parallel (each
 * test file runs in its own worker by default in vitest).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSample,
  reset,
  recordSegmentCacheStats,
  recordBatchMutation,
  recordRafEmission,
  recordRafInvocation,
  resetPipeLoopStats,
} from '../PerfStats';

beforeEach(() => {
  reset();
});

describe('pipeLoop defaults', () => {
  it('zero activity → neutral defaults', () => {
    const { pipeLoop } = getSample();
    expect(pipeLoop.cacheHits).toBe(0);
    expect(pipeLoop.cacheMisses).toBe(0);
    expect(pipeLoop.cacheCalls).toBe(0);
    expect(pipeLoop.cacheHitRate).toBe(1);   // 1 when no pipe touched — don't flag "bad"
    expect(pipeLoop.lastBatchOps).toBe(0);
    expect(pipeLoop.rafEmissionsReceived).toBe(0);
    expect(pipeLoop.rafInvocationsFired).toBe(0);
    expect(pipeLoop.rafDropRate).toBe(0);
  });
});

describe('recordSegmentCacheStats', () => {
  it('accumulates per call', () => {
    recordSegmentCacheStats(5, 3);
    recordSegmentCacheStats(10, 0);
    const { pipeLoop } = getSample();
    expect(pipeLoop.cacheHits).toBe(15);
    expect(pipeLoop.cacheMisses).toBe(3);
    expect(pipeLoop.cacheCalls).toBe(2);
  });

  it('hit rate is hits / (hits + misses)', () => {
    recordSegmentCacheStats(9, 1);
    expect(getSample().pipeLoop.cacheHitRate).toBeCloseTo(0.9);
  });

  it('all misses = 0 hit rate', () => {
    recordSegmentCacheStats(0, 5);
    expect(getSample().pipeLoop.cacheHitRate).toBe(0);
  });
});

describe('recordBatchMutation', () => {
  it('stores last batch size (not cumulative)', () => {
    recordBatchMutation(40);
    recordBatchMutation(12);
    expect(getSample().pipeLoop.lastBatchOps).toBe(12);
  });

  it('zero batch size is valid (empty-cancel case)', () => {
    recordBatchMutation(8);
    recordBatchMutation(0);
    expect(getSample().pipeLoop.lastBatchOps).toBe(0);
  });
});

describe('rAF emission / invocation counters', () => {
  it('no drops when 1:1', () => {
    recordRafEmission(); recordRafInvocation();
    recordRafEmission(); recordRafInvocation();
    const { pipeLoop } = getSample();
    expect(pipeLoop.rafEmissionsReceived).toBe(2);
    expect(pipeLoop.rafInvocationsFired).toBe(2);
    expect(pipeLoop.rafDropRate).toBe(0);
  });

  it('realistic pattern — 10 emissions coalesce into 2 invocations → 80% drop', () => {
    for (let i = 0; i < 10; i++) recordRafEmission();
    recordRafInvocation();
    recordRafInvocation();
    const { pipeLoop } = getSample();
    expect(pipeLoop.rafEmissionsReceived).toBe(10);
    expect(pipeLoop.rafInvocationsFired).toBe(2);
    expect(pipeLoop.rafDropRate).toBeCloseTo(0.8);
  });

  it('drop rate floored at 0 (can\'t go negative if invocations exceed emissions)', () => {
    // Shouldn't happen in reality but guard against a bookkeeping bug.
    recordRafEmission();
    recordRafInvocation();
    recordRafInvocation();
    recordRafInvocation();
    expect(getSample().pipeLoop.rafDropRate).toBe(0);
  });
});

describe('resetPipeLoopStats', () => {
  it('clears pipe metrics without touching frame / worker telemetry', () => {
    recordSegmentCacheStats(10, 5);
    recordBatchMutation(20);
    recordRafEmission();
    recordRafInvocation();

    resetPipeLoopStats();

    const { pipeLoop } = getSample();
    expect(pipeLoop.cacheHits).toBe(0);
    expect(pipeLoop.cacheMisses).toBe(0);
    expect(pipeLoop.cacheCalls).toBe(0);
    expect(pipeLoop.lastBatchOps).toBe(0);
    expect(pipeLoop.rafEmissionsReceived).toBe(0);
    expect(pipeLoop.rafInvocationsFired).toBe(0);
  });
});

describe('reset() also clears pipe loop', () => {
  it('global reset wipes pipe metrics too', () => {
    recordSegmentCacheStats(100, 20);
    recordBatchMutation(7);
    reset();
    const { pipeLoop } = getSample();
    expect(pipeLoop.cacheHits).toBe(0);
    expect(pipeLoop.cacheMisses).toBe(0);
    expect(pipeLoop.lastBatchOps).toBe(0);
  });
});

describe('getSample().pipeLoop matches metrics type', () => {
  it('all fields present on every call', () => {
    const { pipeLoop } = getSample();
    // Guard against future field addition breaking the HUD silently.
    const keys = Object.keys(pipeLoop).sort();
    expect(keys).toEqual([
      'cacheCalls',
      'cacheHitRate',
      'cacheHits',
      'cacheMisses',
      'lastBatchOps',
      'rafDropRate',
      'rafEmissionsReceived',
      'rafInvocationsFired',
    ]);
  });
});
