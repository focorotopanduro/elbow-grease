/**
 * PerfStats — Phase 10.D tests.
 *
 * Covers:
 *   • recordFrame updates fps + history
 *   • EMA smoothing settles toward the instantaneous FPS
 *   • percentile + mean behave correctly
 *   • recordWorkerRoundTrip populates latency + p95
 *   • recordRenderInfo populates draw calls + triangles
 *   • getSample produces chronological history (oldest first)
 *   • reset() zeroes all counters
 *   • heap readout degrades gracefully when performance.memory missing
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  recordFrame,
  recordWorkerRoundTrip,
  recordRenderInfo,
  getSample,
  reset,
  __testables,
} from '../PerfStats';

beforeEach(() => {
  reset();
});

describe('recordFrame', () => {
  it('stores the latest frame time and updates history', () => {
    recordFrame(16.6);
    const s = getSample();
    expect(s.frameTimeMs).toBeCloseTo(16.6, 1);
    // fps moves toward 1000/16.6 ≈ 60.24 with alpha 0.1 from seed 60
    expect(s.fps).toBeGreaterThan(59);
    expect(s.fps).toBeLessThan(61);
  });

  it('EMA drops FPS after sustained slow frames', () => {
    // Feed 100 frames at 20 ms (50 fps) — EMA should settle near 50.
    for (let i = 0; i < 100; i++) recordFrame(20);
    const s = getSample();
    expect(s.fps).toBeGreaterThan(49);
    expect(s.fps).toBeLessThan(51);
  });

  it('guards against dt=0 (no Infinity in fps)', () => {
    recordFrame(0);
    const s = getSample();
    expect(Number.isFinite(s.fps)).toBe(true);
    expect(s.fps).toBeGreaterThan(0);
  });

  it('history is chronological (oldest first) with exactly FRAME_HISTORY_SIZE samples', () => {
    const N = __testables.FRAME_HISTORY_SIZE;
    // Feed a distinctive ramp: 1, 2, 3, ..., N.
    for (let i = 1; i <= N; i++) recordFrame(i);
    const { frameTimeHistory } = getSample();
    expect(frameTimeHistory.length).toBe(N);
    // Oldest first, newest last.
    expect(frameTimeHistory[0]).toBeCloseTo(1, 5);
    expect(frameTimeHistory[N - 1]).toBeCloseTo(N, 5);
  });

  it('history wraps cleanly past capacity', () => {
    const N = __testables.FRAME_HISTORY_SIZE;
    // Feed 2× capacity — the second half should overwrite the first.
    for (let i = 1; i <= 2 * N; i++) recordFrame(i);
    const { frameTimeHistory } = getSample();
    // History should contain N+1 .. 2N.
    expect(frameTimeHistory[0]).toBeCloseTo(N + 1, 5);
    expect(frameTimeHistory[N - 1]).toBeCloseTo(2 * N, 5);
  });
});

describe('mean + p95 frame time', () => {
  it('mean equals the arithmetic average of recorded samples', () => {
    recordFrame(10);
    recordFrame(20);
    recordFrame(30);
    const s = getSample();
    // Only 3 real samples; the rest of the ring is zero (fresh buffer).
    // The valid-sample slice is just those 3, so mean = 20.
    expect(s.meanFrameTimeMs).toBeCloseTo(20, 1);
  });

  it('p95 picks a tail sample', () => {
    // 19× 10ms + 1× 100ms → p95 index picks the tail.
    for (let i = 0; i < 19; i++) recordFrame(10);
    recordFrame(100);
    const s = getSample();
    expect(s.p95FrameTimeMs).toBe(100);
  });
});

describe('recordWorkerRoundTrip', () => {
  it('stores latest latency', () => {
    recordWorkerRoundTrip(12.5);
    const s = getSample();
    expect(s.workerLatencyMs).toBeCloseTo(12.5, 2);
  });

  it('p95 over the last 20 solves', () => {
    for (let i = 0; i < 19; i++) recordWorkerRoundTrip(5);
    recordWorkerRoundTrip(200);
    const s = getSample();
    // Sorted: [5 × 19, 200]. p95 idx = floor(20*0.95)=19 → 200.
    expect(s.workerLatencyP95).toBe(200);
  });

  it('returns 0 for both when no solves recorded', () => {
    const s = getSample();
    expect(s.workerLatencyMs).toBe(0);
    expect(s.workerLatencyP95).toBe(0);
  });
});

describe('recordRenderInfo', () => {
  it('stores draw calls and triangles', () => {
    recordRenderInfo(42, 12345);
    const s = getSample();
    expect(s.drawCalls).toBe(42);
    expect(s.triangles).toBe(12345);
  });
});

describe('heap readout', () => {
  it('returns null when performance.memory is absent', () => {
    // jsdom doesn't ship performance.memory by default. The double-cast
    // through `unknown` lets us poke this non-standard prop without the
    // need for @ts-expect-error.
    const perfMemHolder = performance as unknown as { memory?: unknown };
    const original = perfMemHolder.memory;
    delete perfMemHolder.memory;

    const s = getSample();
    expect(s.heapUsedMB).toBeNull();
    expect(s.heapLimitMB).toBeNull();

    if (original) perfMemHolder.memory = original;
  });

  it('returns MB values when performance.memory is present', () => {
    const perf = performance as unknown as {
      memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
    };
    perf.memory = {
      usedJSHeapSize: 50 * 1024 * 1024,
      jsHeapSizeLimit: 2048 * 1024 * 1024,
    };
    const s = getSample();
    expect(s.heapUsedMB).toBeCloseTo(50, 1);
    expect(s.heapLimitMB).toBeCloseTo(2048, 1);

    // cleanup
    delete perf.memory;
  });
});

describe('reset', () => {
  it('clears all counters', () => {
    recordFrame(25);
    recordWorkerRoundTrip(30);
    recordRenderInfo(10, 5000);
    reset();
    const s = getSample();
    expect(s.frameTimeMs).toBe(0);
    expect(s.drawCalls).toBe(0);
    expect(s.triangles).toBe(0);
    expect(s.workerLatencyMs).toBe(0);
    expect(s.workerLatencyP95).toBe(0);
    // fps resets to the 60 seed.
    expect(s.fps).toBeCloseTo(60, 0);
  });
});

describe('regression guards', () => {
  it('many back-to-back getSample calls do not mutate history', () => {
    recordFrame(16);
    recordFrame(17);
    recordFrame(18);
    const a = Array.from(getSample().frameTimeHistory);
    for (let i = 0; i < 100; i++) getSample();
    const b = Array.from(getSample().frameTimeHistory);
    expect(a).toEqual(b);
  });

  it('calling recordFrame from inside a loop does not drop samples', () => {
    const N = __testables.FRAME_HISTORY_SIZE;
    const values: number[] = [];
    for (let i = 1; i <= N; i++) {
      values.push(i * 1.5);
      recordFrame(i * 1.5);
    }
    const s = getSample();
    // Compare chronological history with what we fed.
    const actual = Array.from(s.frameTimeHistory);
    expect(actual.length).toBe(N);
    for (let i = 0; i < N; i++) {
      expect(actual[i]).toBeCloseTo(values[i]!, 5);
    }
  });
});

// Silence any perf.memory pollution left by tests running in odd order.
vi.restoreAllMocks();
