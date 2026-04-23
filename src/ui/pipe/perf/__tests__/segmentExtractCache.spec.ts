/**
 * segmentExtractCache — Phase 14.AC.2 tests.
 *
 * Exercises:
 *   • Gate correctness: invisible, selected, phase-filtered,
 *     system-hidden, floor-hidden pipes → null entry → no segments.
 *   • Cache hits: unchanged pipe ref ⇒ no rebuild.
 *   • Cache misses: mutated pipe ref ⇒ that slot rebuilds.
 *   • Evictions: removed pipe ⇒ slot pruned.
 *   • Context invalidation: any external gate ref change ⇒ full clear.
 *   • Bucket assembly: two pipes with matching (diameter, material,
 *     floor) share a bucket; differing floor params produce separate
 *     buckets.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SegmentExtractCache,
  buildPipeEntry,
  type ExtractContext,
} from '../segmentExtractCache';
import type { CommittedPipe } from '@store/pipeStore';
import type { FloorRenderParams } from '@store/floorStore';

// ── Fixtures ──────────────────────────────────────────────────

const ALL_VISIBLE: ExtractContext['systemVisibility'] = {
  cold_supply: true,
  hot_supply: true,
  waste: true,
  vent: true,
  storm: true,
  condensate: true,
};

const ALL_FLOORS_VISIBLE: (yMin: number, yMax: number) => FloorRenderParams =
  () => ({ visible: true, opacity: 1, colorOverride: null, disableInteraction: false });

const GHOSTED_FLOOR: (yMin: number, yMax: number) => FloorRenderParams =
  () => ({ visible: true, opacity: 0.3, colorOverride: null, disableInteraction: true });

const INVISIBLE_FLOOR: (yMin: number, yMax: number) => FloorRenderParams =
  () => ({ visible: false, opacity: 0, colorOverride: null, disableInteraction: true });

const PHASE_ALL: ExtractContext['phaseFilter'] = {
  activePhase: 'rough_in',
  mode: 'all',
  pipeOverride: () => undefined,
};

function makePipe(
  id: string,
  overrides: Partial<CommittedPipe> = {},
): CommittedPipe {
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

function makeCtx(overrides: Partial<ExtractContext> = {}): ExtractContext {
  return {
    systemVisibility: ALL_VISIBLE,
    getFloorParams: ALL_FLOORS_VISIBLE,
    phaseFilter: PHASE_ALL,
    ...overrides,
  };
}

// ── buildPipeEntry — gating ──────────────────────────────────

describe('buildPipeEntry — gating', () => {
  it('visible + non-selected + system-enabled + phase-matched → entry', () => {
    const entry = buildPipeEntry(makePipe('p1'), makeCtx());
    expect(entry).not.toBeNull();
    expect(entry!.bucketKey).toBe('2__pvc_sch40__full');
    expect(entry!.segments).toHaveLength(1);
  });

  it('invisible pipe → null', () => {
    expect(buildPipeEntry(makePipe('p', { visible: false }), makeCtx())).toBeNull();
  });

  it('selected pipe → null (rendered by the highlight layer, not the instancer)', () => {
    expect(buildPipeEntry(makePipe('p', { selected: true }), makeCtx())).toBeNull();
  });

  it('hidden system → null', () => {
    const ctx = makeCtx({ systemVisibility: { ...ALL_VISIBLE, cold_supply: false } });
    expect(buildPipeEntry(makePipe('p'), ctx)).toBeNull();
  });

  it('floor-hidden pipe → null', () => {
    expect(buildPipeEntry(makePipe('p'), makeCtx({ getFloorParams: INVISIBLE_FLOOR }))).toBeNull();
  });

  it('ghosted-floor pipe produces a ghost-bucket key', () => {
    const entry = buildPipeEntry(makePipe('p'), makeCtx({ getFloorParams: GHOSTED_FLOOR }));
    expect(entry).not.toBeNull();
    expect(entry!.bucketKey).toContain('g0.30');
    expect(entry!.segments[0]!.opacity).toBeCloseTo(0.3);
  });

  it('phase override takes precedence over auto-classification', () => {
    const ctx = makeCtx({
      phaseFilter: {
        activePhase: 'rough_in',
        mode: 'single',
        pipeOverride: (id) => (id === 'p' ? 'underground' : undefined),
      },
    });
    // overridden to 'underground', active is 'rough_in', mode 'single' → filtered out
    expect(buildPipeEntry(makePipe('p'), ctx)).toBeNull();
  });
});

// ── SegmentExtractCache — caching behaviour ──────────────────

describe('SegmentExtractCache', () => {
  let cache: SegmentExtractCache;
  beforeEach(() => {
    cache = new SegmentExtractCache();
  });

  it('first extract is all misses', () => {
    const pipes = { a: makePipe('a'), b: makePipe('b') };
    cache.extract(pipes, makeCtx());
    expect(cache.lastMisses).toBe(2);
    expect(cache.lastHits).toBe(0);
    expect(cache.size).toBe(2);
  });

  it('second extract with unchanged refs is all hits', () => {
    const pipes = { a: makePipe('a'), b: makePipe('b') };
    const ctx = makeCtx();
    cache.extract(pipes, ctx);
    cache.extract(pipes, ctx);
    expect(cache.lastMisses).toBe(0);
    expect(cache.lastHits).toBe(2);
  });

  it('mutating one pipe ref causes exactly one miss', () => {
    const a0 = makePipe('a');
    const b = makePipe('b');
    const ctx = makeCtx();
    cache.extract({ a: a0, b }, ctx);

    // Simulate Zustand immutable update — new object, same id
    const a1 = { ...a0, diameter: 3 };
    cache.extract({ a: a1, b }, ctx);

    expect(cache.lastMisses).toBe(1);
    expect(cache.lastHits).toBe(1);
  });

  it('adding a pipe adds one slot without recomputing old ones', () => {
    const a = makePipe('a');
    const b = makePipe('b');
    const ctx = makeCtx();
    cache.extract({ a, b }, ctx);

    const c = makePipe('c');
    cache.extract({ a, b, c }, ctx);

    expect(cache.lastMisses).toBe(1);
    expect(cache.lastHits).toBe(2);
    expect(cache.size).toBe(3);
  });

  it('removing a pipe evicts its slot', () => {
    const a = makePipe('a');
    const b = makePipe('b');
    const ctx = makeCtx();
    cache.extract({ a, b }, ctx);

    cache.extract({ a }, ctx);
    expect(cache.lastEvictions).toBe(1);
    expect(cache.size).toBe(1);
  });

  it('changing systemVisibility ref invalidates whole cache', () => {
    const a = makePipe('a');
    const b = makePipe('b');
    cache.extract({ a, b }, makeCtx());

    cache.extract({ a, b }, makeCtx({ systemVisibility: { ...ALL_VISIBLE } })); // new ref, same values
    expect(cache.lastHits).toBe(0);
    expect(cache.lastMisses).toBe(2);
  });

  it('changing getFloorParams ref invalidates whole cache', () => {
    const a = makePipe('a');
    cache.extract({ a }, makeCtx());

    // New fn ref → invalidate even though result is identical
    const newFn = (_yMin: number, _yMax: number): FloorRenderParams => ({
      visible: true, opacity: 1, colorOverride: null, disableInteraction: false,
    });
    cache.extract({ a }, makeCtx({ getFloorParams: newFn }));
    expect(cache.lastHits).toBe(0);
    expect(cache.lastMisses).toBe(1);
  });

  it('changing phaseFilter ref invalidates whole cache', () => {
    const a = makePipe('a');
    cache.extract({ a }, makeCtx());

    cache.extract({ a }, makeCtx({
      phaseFilter: { activePhase: 'rough_in', mode: 'all', pipeOverride: () => undefined },
    }));
    expect(cache.lastHits).toBe(0);
    expect(cache.lastMisses).toBe(1);
  });

  it('invalidate() clears cache', () => {
    const a = makePipe('a');
    cache.extract({ a }, makeCtx());
    cache.invalidate();
    expect(cache.size).toBe(0);
  });

  it('pipes sharing diameter+material+floor share a bucket', () => {
    const a = makePipe('a');
    const b = makePipe('b', { points: [[10, 5, 0], [20, 5, 0]] });
    const buckets = cache.extract({ a, b }, makeCtx());
    expect(buckets.size).toBe(1);
    expect(buckets.get('2__pvc_sch40__full')!).toHaveLength(2);
  });

  it('pipes with differing diameter produce separate buckets', () => {
    const a = makePipe('a', { diameter: 2 });
    const b = makePipe('b', { diameter: 3 });
    const buckets = cache.extract({ a, b }, makeCtx());
    expect(buckets.size).toBe(2);
  });

  it('ghosted + non-ghosted pipes go to separate buckets', () => {
    const a = makePipe('a', { points: [[0, 5, 0], [5, 5, 0]] });
    // Floor params differ based on y — build a getFloorParams that
    // ghosts anything above Y=10.
    const yAwareFloor = (_yMin: number, yMax: number): FloorRenderParams => {
      if (yMax > 10) return { visible: true, opacity: 0.3, colorOverride: null, disableInteraction: true };
      return { visible: true, opacity: 1, colorOverride: null, disableInteraction: false };
    };
    const b = makePipe('b', { points: [[0, 15, 0], [5, 15, 0]] });
    const buckets = cache.extract({ a, b }, makeCtx({ getFloorParams: yAwareFloor }));
    expect(buckets.size).toBe(2);
  });

  it('gated-out pipe stays cached as null and hits on repeat', () => {
    // If a pipe is invisible but its ref is unchanged, we shouldn't
    // rebuild the entry on the next call.
    const hidden = makePipe('p', { visible: false });
    cache.extract({ p: hidden }, makeCtx());
    cache.extract({ p: hidden }, makeCtx());
    expect(cache.lastHits).toBe(1);
    expect(cache.lastMisses).toBe(0);
  });
});

// ── Realism scenario ─────────────────────────────────────────

describe('SegmentExtractCache — realistic flow', () => {
  it('100 pipes, then single add, then single edit, then layer toggle', () => {
    const cache = new SegmentExtractCache();
    const ctx = makeCtx();

    // Seed 100 pipes across two diameters
    const pipes: Record<string, CommittedPipe> = {};
    for (let i = 0; i < 100; i++) {
      pipes[`p${i}`] = makePipe(`p${i}`, {
        diameter: i % 2 === 0 ? 2 : 3,
        points: [[i, 5, 0], [i + 1, 5, 0]],
      });
    }
    cache.extract(pipes, ctx);
    expect(cache.lastMisses).toBe(100);

    // Add one more — 1 miss, 100 hits
    const newPipes: Record<string, CommittedPipe> = { ...pipes, p100: makePipe('p100') };
    cache.extract(newPipes, ctx);
    expect(cache.lastMisses).toBe(1);
    expect(cache.lastHits).toBe(100);

    // Edit one existing — 1 miss, 100 hits
    const editedPipes: Record<string, CommittedPipe> = {
      ...newPipes,
      p50: { ...newPipes.p50!, diameter: 4 },
    };
    cache.extract(editedPipes, ctx);
    expect(cache.lastMisses).toBe(1);
    expect(cache.lastHits).toBe(100);

    // Layer toggle (new systemVisibility ref) — full invalidation
    cache.extract(editedPipes, makeCtx({ systemVisibility: { ...ALL_VISIBLE } }));
    expect(cache.lastMisses).toBe(101);
    expect(cache.lastHits).toBe(0);
  });
});
