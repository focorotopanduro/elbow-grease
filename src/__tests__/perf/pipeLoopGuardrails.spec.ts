/**
 * Pipe Loop Guardrails — Phase 14.AC.5.
 *
 * The correctness tests shipped with 14.AC.1–3 all pass, but none of
 * them locks in the EFFICIENCY gains those phases produced:
 *
 *   • Segment-extract cache (14.AC.2) — a ref-stability regression on
 *     `usePhaseFilter` / `useFloorParams` / `systemVisibility` would
 *     silently drop the hit rate to 0% while every existing test
 *     still passes.
 *   • Bridge batch mutate (14.AC.3) — a refactor that slips per-
 *     segment postMessages back into the commit path wouldn't be
 *     noticed by unit tests; the existing bridge spec does assert
 *     "zero ADD_NODE" for a single burst but nothing prevents new
 *     bridge paths from sidestepping the batch.
 *   • rAF-coalesced events (14.AC.1) — if someone swaps
 *     `useRafEvent` back to `useEvent` on a hot subscriber, no
 *     correctness test complains — responsiveness just gets worse.
 *
 * This file asserts the SLOs directly: realistic workloads produce
 * the hit / batch / drop rates we expect. A future regression in
 * ref stability or hot-path wiring fails these tests and names the
 * culprit subsystem.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eventBus } from '@core/EventBus';
import { simBus, SIM_MSG, type SimMessage } from '../../engine/graph/MessageBus';
import { EV, type PipeCompletePayload } from '@core/events';
import { SimulationBridge } from '../../engine/worker/SimulationBridge';
import { SegmentExtractCache, type ExtractContext } from '../../ui/pipe/perf/segmentExtractCache';
import { reset as resetPerfStats, getSample } from '@core/perf/PerfStats';
import { useRafEvent } from '../../hooks/useRafEvent';
import { renderHook } from '@testing-library/react';
import type { CommittedPipe } from '@store/pipeStore';
import type { FloorRenderParams } from '@store/floorStore';

// ── Shared fixtures ──────────────────────────────────────────

const ALL_VISIBLE: ExtractContext['systemVisibility'] = {
  cold_supply: true, hot_supply: true, waste: true, vent: true, storm: true, condensate: true,
};

const VISIBLE_FLOOR = (_yMin: number, _yMax: number): FloorRenderParams =>
  ({ visible: true, opacity: 1, colorOverride: null, disableInteraction: false });

const PHASE_ALL = {
  activePhase: 'rough_in' as const,
  mode: 'all' as const,
  pipeOverride: () => undefined,
};

function makePipe(id: string, overrides: Partial<CommittedPipe> = {}): CommittedPipe {
  return {
    id,
    points: [[0, 5, 0], [5, 5, 0]],
    diameter: 2,
    material: 'pvc_sch40',
    system: 'cold_supply',
    color: '#ffa726',
    visible: true,
    selected: false,
    ...overrides,
  };
}

function buildScene(n: number): Record<string, CommittedPipe> {
  const pipes: Record<string, CommittedPipe> = {};
  for (let i = 0; i < n; i++) {
    pipes[`p${i}`] = makePipe(`p${i}`, {
      diameter: (i % 3) + 2,
      points: [[i * 2, 5, 0], [i * 2 + 1.5, 5, 0]],
    });
  }
  return pipes;
}

// ── 14.AC.2 guardrail: cache hit rate ────────────────────────

describe('14.AC.2 guardrail — SegmentExtractCache hit rate', () => {
  // STABLE ref objects that mirror how the real hooks behave:
  //   • usePlumbingLayerStore((s) => s.systems)     — stable until layers toggle
  //   • useFloorParams()                    — module-level function
  //   • usePhaseFilter()                    — useMemo'd
  // If any of these start returning fresh refs per render the cache
  // clears and these guardrails fail.
  const ctx: ExtractContext = {
    systemVisibility: ALL_VISIBLE,
    getFloorParams: VISIBLE_FLOOR,
    phaseFilter: PHASE_ALL,
  };

  it('adding 1 pipe to a 100-pipe scene: ≥99% hit rate on the second extract', () => {
    const cache = new SegmentExtractCache();
    const pipes = buildScene(100);
    cache.extract(pipes, ctx);

    const pipes2 = { ...pipes, p100: makePipe('p100') };
    cache.extract(pipes2, ctx);

    const total = cache.lastHits + cache.lastMisses;
    const hitRate = cache.lastHits / total;
    expect(hitRate).toBeGreaterThanOrEqual(0.99);
    // Exact numbers for debuggability:
    expect(cache.lastHits).toBe(100);
    expect(cache.lastMisses).toBe(1);
  });

  it('editing 1 pipe of 100: exactly 1 miss, 99 hits', () => {
    const cache = new SegmentExtractCache();
    const pipes = buildScene(100);
    cache.extract(pipes, ctx);

    // Simulate Zustand immutable update on p50
    const edited = { ...pipes, p50: { ...pipes.p50!, diameter: 4 } };
    cache.extract(edited, ctx);

    expect(cache.lastMisses).toBe(1);
    expect(cache.lastHits).toBe(99);
  });

  it('editing 5 pipes of 100: exactly 5 misses, 95 hits', () => {
    const cache = new SegmentExtractCache();
    const pipes = buildScene(100);
    cache.extract(pipes, ctx);

    // Edit 5 different pipes
    const edited = { ...pipes };
    for (const i of [10, 25, 50, 75, 90]) {
      edited[`p${i}`] = { ...pipes[`p${i}`]!, diameter: 6 };
    }
    cache.extract(edited, ctx);

    expect(cache.lastMisses).toBe(5);
    expect(cache.lastHits).toBe(95);
  });

  it('steady state with no mutations: 100% hit rate across 10 re-extracts', () => {
    const cache = new SegmentExtractCache();
    const pipes = buildScene(50);
    cache.extract(pipes, ctx); // seed

    for (let i = 0; i < 10; i++) {
      cache.extract(pipes, ctx);
      expect(cache.lastMisses).toBe(0);
      expect(cache.lastHits).toBe(50);
    }
  });

  it('ctx ref change is the ONLY thing that forces full invalidation', () => {
    const cache = new SegmentExtractCache();
    const pipes = buildScene(50);

    // First pass — all misses
    cache.extract(pipes, ctx);
    expect(cache.lastMisses).toBe(50);

    // Same ctx ref + same pipes → all hits
    cache.extract(pipes, ctx);
    expect(cache.lastHits).toBe(50);

    // Only touching ctx.systemVisibility ref (not its values) invalidates.
    const ctx2: ExtractContext = {
      ...ctx,
      systemVisibility: { ...ALL_VISIBLE }, // new object, identical contents
    };
    cache.extract(pipes, ctx2);
    expect(cache.lastMisses).toBe(50);
  });
});

// ── 14.AC.3 guardrail: batch coalescing ──────────────────────

describe('14.AC.3 guardrail — SimulationBridge batching', () => {
  let bridge: SimulationBridge;
  let sawBatches = 0;
  let sawSolves = 0;
  let sawSingleMutations = 0;
  let unsubs: Array<() => void> = [];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    sawBatches = 0;
    sawSolves = 0;
    sawSingleMutations = 0;
    unsubs = [];
    eventBus.clear();
    simBus.clear();
    bridge = new SimulationBridge();

    unsubs.push(simBus.on(SIM_MSG.BATCH_MUTATE, () => { sawBatches++; }));
    unsubs.push(simBus.on(SIM_MSG.SOLVE_REQUEST, () => { sawSolves++; }));
    unsubs.push(simBus.on(SIM_MSG.ADD_NODE, () => { sawSingleMutations++; }));
    unsubs.push(simBus.on(SIM_MSG.ADD_EDGE, () => { sawSingleMutations++; }));
    unsubs.push(simBus.on(SIM_MSG.REMOVE_NODE, () => { sawSingleMutations++; }));
    unsubs.push(simBus.on(SIM_MSG.REMOVE_EDGE, () => { sawSingleMutations++; }));
  });

  afterEach(() => {
    for (const u of unsubs) u();
    bridge.destroy();
    vi.useRealTimers();
    eventBus.clear();
    simBus.clear();
  });

  function emitCommit(id: string, points: number) {
    const payload: PipeCompletePayload = {
      id,
      points: Array.from({ length: points }, (_, i) => [i, 0, 0] as [number, number, number]),
      diameter: 2,
      material: 'pvc_sch40',
    };
    eventBus.emit(EV.PIPE_COMPLETE, payload);
  }

  it('20 pipes committed in one burst → exactly 1 BATCH_MUTATE + 1 SOLVE', () => {
    for (let i = 0; i < 20; i++) emitCommit(`p${i}`, 4);
    vi.runAllTimers();
    expect(sawBatches).toBe(1);
    expect(sawSolves).toBe(1);
  });

  it('commit path emits ZERO individual ADD_NODE / ADD_EDGE messages', () => {
    for (let i = 0; i < 5; i++) emitCommit(`p${i}`, 3);
    vi.runAllTimers();
    expect(sawSingleMutations).toBe(0);
  });

  it('mixed commit + remove in one burst → still 1 batch', () => {
    emitCommit('a', 3);
    emitCommit('b', 3);
    eventBus.emit('pipe:removed', { id: 'a' });
    emitCommit('c', 3);
    vi.runAllTimers();
    expect(sawBatches).toBe(1);
    expect(sawSingleMutations).toBe(0);
  });

  it('bursts separated by the debounce window → separate batches', () => {
    emitCommit('a', 3);
    vi.runAllTimers(); // flushes first debounce
    emitCommit('b', 3);
    vi.runAllTimers(); // flushes second debounce
    expect(sawBatches).toBe(2);
    expect(sawSolves).toBe(2);
  });

  it('100-pipe riser-template-style paste → 1 batch, scales without quadratic cost', () => {
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) emitCommit(`p${i}`, 3);
    vi.runAllTimers();
    const elapsed = performance.now() - t0;
    expect(sawBatches).toBe(1);
    // Sanity: 100 commits + flush should be well under any perceptual
    // budget. This is a loose upper bound — tightening below 100 ms
    // is a cross-machine guarantee we can't make in CI.
    expect(elapsed).toBeLessThan(500);
  });
});

// ── 14.AC.1 guardrail: rAF event coalescing ──────────────────

describe('14.AC.1 guardrail — useRafEvent coalescing', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
    eventBus.clear();
    resetPerfStats();
  });

  afterEach(() => {
    vi.useRealTimers();
    eventBus.clear();
  });

  it('10-emission burst in one frame produces exactly 1 handler invocation', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useRafEvent<number>('guardrail:burst10', handler));

    for (let i = 0; i < 10; i++) eventBus.emit('guardrail:burst10', i);
    vi.runAllTimers();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(9); // latest payload wins
    unmount();
  });

  it('60 emissions across 10 frames produce at most 10 invocations', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useRafEvent<number>('guardrail:60in10', handler));

    for (let frame = 0; frame < 10; frame++) {
      // Simulate 6 emissions per frame (realistic high-refresh drag rate)
      for (let i = 0; i < 6; i++) {
        eventBus.emit('guardrail:60in10', frame * 10 + i);
      }
      vi.runAllTimers();
    }

    // One invocation per frame with events = 10 total. Never more.
    expect(handler.mock.calls.length).toBeLessThanOrEqual(10);
    unmount();
  });

  it('PerfStats drop rate ≥ 83% for a 60/10 burst pattern', () => {
    // This is the realistic-workload SLO. If the coalescer stops
    // coalescing this test catches it — drop rate ~0% would fail.
    const handler = vi.fn();
    const { unmount } = renderHook(() => useRafEvent<number>('guardrail:sl0', handler));

    for (let frame = 0; frame < 10; frame++) {
      for (let i = 0; i < 6; i++) eventBus.emit('guardrail:sl0', frame * 10 + i);
      vi.runAllTimers();
    }

    const { pipeLoop } = getSample();
    expect(pipeLoop.rafEmissionsReceived).toBe(60);
    expect(pipeLoop.rafInvocationsFired).toBeLessThanOrEqual(10);
    expect(pipeLoop.rafDropRate).toBeGreaterThanOrEqual(0.83);
    unmount();
  });
});
