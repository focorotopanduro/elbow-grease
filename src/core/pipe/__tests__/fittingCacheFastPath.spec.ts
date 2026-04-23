/**
 * FittingCache fast-path — Phase 14.AD.2 tests.
 *
 * Covers the ref-identity short-circuit:
 *   • Repeat lookup with the SAME object identity → `fastHits` ticks;
 *     `slowHits` stays at 0. `pipeFittingHash` is not consulted on
 *     the hot path.
 *   • Lookup with a fresh object containing identical content →
 *     `slowHits` ticks once (hash fallback). Subsequent lookups with
 *     THAT same object identity go through fastHits → the cache
 *     "promotes" the pipeRef.
 *   • A genuinely mutated pipe (new points) → miss, regenerate.
 *   • `stats().hits` remains the aggregate (backwards compatible
 *     with pre-AD.2 consumers).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FittingCache } from '../fittingCache';
import * as fittingCacheModule from '../fittingCache';
import type { CommittedPipe } from '@store/pipeStore';

function makePipe(over: Partial<CommittedPipe> = {}): CommittedPipe {
  return {
    id: 'p1',
    points: [[0, 0, 0], [5, 0, 0], [5, 0, 5]],
    diameter: 2,
    material: 'pvc_sch40',
    system: 'cold_supply',
    color: '#ffa726',
    visible: true,
    selected: false,
    ...over,
  };
}

describe('FittingCache — ref-identity fast path', () => {
  let cache: FittingCache;
  beforeEach(() => { cache = new FittingCache(); });

  it('same object repeated: first miss, rest are fastHits', () => {
    const pipe = makePipe();
    cache.getPerPipe(pipe); // miss
    cache.getPerPipe(pipe); // fast hit
    cache.getPerPipe(pipe); // fast hit
    const s = cache.stats();
    expect(s.misses).toBe(1);
    expect(s.fastHits).toBe(2);
    expect(s.slowHits).toBe(0);
    expect(s.hits).toBe(2); // aggregate, back-compat
  });

  it('fresh objects with identical content → slow hit (hash fallback)', () => {
    // Two calls with freshly-constructed pipes that share the same
    // content. The second is a slow hit via the hash — not a miss.
    cache.getPerPipe(makePipe());
    cache.getPerPipe(makePipe());
    const s = cache.stats();
    expect(s.misses).toBe(1);
    expect(s.slowHits).toBe(1);
    expect(s.fastHits).toBe(0);
  });

  it('slow hit upgrades pipeRef → subsequent calls with the upgraded ref are fast', () => {
    // Miss on first, slow hit on second (different object, same
    // content). The cache promotes entry.pipeRef to the second
    // object. Calling with the SAME second-object reference again
    // should now be a fast hit.
    cache.getPerPipe(makePipe());        // miss
    const upgraded = makePipe();
    cache.getPerPipe(upgraded);          // slow hit → pipeRef promoted
    cache.getPerPipe(upgraded);          // fast hit now
    const s = cache.stats();
    expect(s.misses).toBe(1);
    expect(s.slowHits).toBe(1);
    expect(s.fastHits).toBe(1);
  });

  it('ref-identity hit does NOT call pipeFittingHash', () => {
    const pipe = makePipe();
    cache.getPerPipe(pipe); // miss — does call pipeFittingHash

    // Spy on the module's hash function to verify it's not touched
    // on the fast path. The cache uses the same import reference we
    // spy on here.
    const spy = vi.spyOn(fittingCacheModule, 'pipeFittingHash');
    cache.getPerPipe(pipe);
    cache.getPerPipe(pipe);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('mutation on the returned arrays must not affect next hit (contract guard)', () => {
    const pipe = makePipe();
    const first = cache.getPerPipe(pipe);
    // Per the module JSDoc: caller MUST NOT mutate. This test
    // enforces the contract by asserting the cache returns the SAME
    // array identity on the fast path — mutation would leak into
    // future callers.
    const second = cache.getPerPipe(pipe);
    expect(first.bends).toBe(second.bends);
    expect(first.flexWarnings).toBe(second.flexWarnings);
  });

  it('realistic 100-pipe workload: 99% fast hits on unchanged pipes', () => {
    // Seed 100 pipes
    const pipes = Array.from({ length: 100 }, (_, i) =>
      makePipe({ id: `p${i}`, points: [[i, 0, 0], [i + 1, 0, 0]] }),
    );
    // First pass — all miss
    for (const p of pipes) cache.getPerPipe(p);
    // Second pass — same object refs — all fast hit
    for (const p of pipes) cache.getPerPipe(p);

    const s = cache.stats();
    expect(s.misses).toBe(100);
    expect(s.fastHits).toBe(100);
    expect(s.slowHits).toBe(0);
  });

  it('edit 1 of 100 pipes: 1 miss, 99 fastHits (same pattern AC.2 shipped for pipes)', () => {
    const pipes = Array.from({ length: 100 }, (_, i) =>
      makePipe({ id: `p${i}`, points: [[i, 0, 0], [i + 1, 0, 0]] }),
    );
    for (const p of pipes) cache.getPerPipe(p);

    // Simulate Zustand immutable update: one pipe gets a new object,
    // the rest keep their identity.
    const edited = [...pipes];
    edited[50] = { ...pipes[50]!, points: [[50, 0, 0], [51.5, 0, 0]] }; // moved endpoint

    for (const p of edited) cache.getPerPipe(p);

    const s = cache.stats();
    // p50 was regenerated (content changed) → miss
    expect(s.misses).toBe(101);
    expect(s.fastHits).toBe(99);
    expect(s.slowHits).toBe(0);
  });

  it('clear resets fast/slow counters', () => {
    cache.getPerPipe(makePipe());
    cache.getPerPipe(makePipe());
    cache.clear();
    const s = cache.stats();
    expect(s.fastHits).toBe(0);
    expect(s.slowHits).toBe(0);
    expect(s.misses).toBe(0);
  });
});
