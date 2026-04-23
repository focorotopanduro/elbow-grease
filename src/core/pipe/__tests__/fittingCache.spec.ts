/**
 * fittingCache — Phase 14.T tests.
 *
 * Covers:
 *   • Hash stability: same pipe content → same hash
 *   • Hash sensitivity: points / diameter / material changes → different hash
 *   • Hash IGNORES irrelevant fields: color / selected / visible / system
 *   • First call: cache miss; second identical call: cache hit
 *   • Identity: cache hit returns the same array instance (consumer
 *     should not mutate)
 *   • Material change invalidates
 *   • Points change invalidates
 *   • Selection flip DOES NOT invalidate
 *   • pruneMissing drops absent ids
 *   • clear wipes state + stats
 *   • collectPerPipe flattens + prunes
 *   • Singleton accessor returns the same instance
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  FittingCache,
  pipeFittingHash,
  getFittingCache,
  __resetFittingCache,
} from '../fittingCache';
import type { CommittedPipe } from '../../../store/pipeStore';

// ── Pipe factory ────────────────────────────────────────────

function makePipe(overrides: Partial<CommittedPipe> = {}): CommittedPipe {
  return {
    id: 'p1',
    points: [[0, 0, 0], [5, 0, 0], [5, 0, 5]], // two segments, one 90° bend
    diameter: 3,
    material: 'pvc_sch40',
    system: 'waste',
    color: '#66bb6a',
    visible: true,
    selected: false,
    ...overrides,
  };
}

// ── pipeFittingHash ─────────────────────────────────────────

describe('pipeFittingHash', () => {
  it('identical content → identical hash', () => {
    const a = makePipe();
    const b = makePipe();
    expect(pipeFittingHash(a)).toBe(pipeFittingHash(b));
  });

  it('point move → new hash', () => {
    const a = makePipe();
    const b = makePipe({ points: [[0, 0, 0], [6, 0, 0], [6, 0, 5]] });
    expect(pipeFittingHash(a)).not.toBe(pipeFittingHash(b));
  });

  it('diameter change → new hash', () => {
    const a = makePipe({ diameter: 3 });
    const b = makePipe({ diameter: 4 });
    expect(pipeFittingHash(a)).not.toBe(pipeFittingHash(b));
  });

  it('material change → new hash', () => {
    const a = makePipe({ material: 'pvc_sch40' });
    const b = makePipe({ material: 'cast_iron' });
    expect(pipeFittingHash(a)).not.toBe(pipeFittingHash(b));
  });

  it('color change → SAME hash (irrelevant to fittings)', () => {
    const a = makePipe({ color: '#ff0000' });
    const b = makePipe({ color: '#00ff00' });
    expect(pipeFittingHash(a)).toBe(pipeFittingHash(b));
  });

  it('selected flag change → SAME hash', () => {
    const a = makePipe({ selected: false });
    const b = makePipe({ selected: true });
    expect(pipeFittingHash(a)).toBe(pipeFittingHash(b));
  });

  it('visible flag change → SAME hash', () => {
    const a = makePipe({ visible: true });
    const b = makePipe({ visible: false });
    expect(pipeFittingHash(a)).toBe(pipeFittingHash(b));
  });

  it('system change → SAME hash (fittings are shape-only)', () => {
    const a = makePipe({ system: 'waste' });
    const b = makePipe({ system: 'vent' });
    expect(pipeFittingHash(a)).toBe(pipeFittingHash(b));
  });

  it('float drift below µft → same hash (fixed-6 quantization)', () => {
    const a = makePipe({ points: [[0, 0, 0], [5, 0, 0], [5, 0, 5]] });
    const b = makePipe({ points: [[0.0000001, 0, 0], [5, 0, 0], [5, 0, 5]] });
    expect(pipeFittingHash(a)).toBe(pipeFittingHash(b));
  });
});

// ── Cache hit / miss ────────────────────────────────────────

describe('FittingCache.getPerPipe', () => {
  let cache: FittingCache;
  beforeEach(() => { cache = new FittingCache(); });

  it('first call: cache miss', () => {
    cache.getPerPipe(makePipe());
    const s = cache.stats();
    expect(s.misses).toBe(1);
    expect(s.hits).toBe(0);
  });

  it('second identical call: cache hit', () => {
    const pipe = makePipe();
    cache.getPerPipe(pipe);
    cache.getPerPipe(pipe);
    const s = cache.stats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
  });

  it('returns same array identity on hit', () => {
    const pipe = makePipe();
    const first = cache.getPerPipe(pipe);
    const second = cache.getPerPipe(pipe);
    expect(first.bends).toBe(second.bends);
    expect(first.flexWarnings).toBe(second.flexWarnings);
  });

  it('material change invalidates', () => {
    cache.getPerPipe(makePipe({ material: 'pvc_sch40' }));
    cache.getPerPipe(makePipe({ material: 'cast_iron' }));
    const s = cache.stats();
    expect(s.misses).toBe(2);
    expect(s.hits).toBe(0);
  });

  it('points move invalidates', () => {
    cache.getPerPipe(makePipe({ points: [[0, 0, 0], [5, 0, 0], [5, 0, 5]] }));
    cache.getPerPipe(makePipe({ points: [[0, 0, 0], [6, 0, 0], [6, 0, 5]] }));
    const s = cache.stats();
    expect(s.misses).toBe(2);
    expect(s.hits).toBe(0);
  });

  it('selected flag change is a cache HIT (no re-gen)', () => {
    cache.getPerPipe(makePipe({ selected: false }));
    cache.getPerPipe(makePipe({ selected: true }));
    const s = cache.stats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
  });

  it('diameter change invalidates', () => {
    cache.getPerPipe(makePipe({ diameter: 3 }));
    cache.getPerPipe(makePipe({ diameter: 4 }));
    const s = cache.stats();
    expect(s.hits).toBe(0);
  });
});

// ── Eviction / pruning ──────────────────────────────────────

describe('FittingCache.pruneMissing', () => {
  it('drops entries not in currentPipeIds', () => {
    const cache = new FittingCache();
    cache.getPerPipe(makePipe({ id: 'a' }));
    cache.getPerPipe(makePipe({ id: 'b' }));
    cache.getPerPipe(makePipe({ id: 'c' }));
    const removed = cache.pruneMissing(new Set(['b']));
    expect(removed).toBe(2);
    expect(cache.stats().size).toBe(1);
  });

  it('no-op when every id is still present', () => {
    const cache = new FittingCache();
    cache.getPerPipe(makePipe({ id: 'a' }));
    const removed = cache.pruneMissing(new Set(['a']));
    expect(removed).toBe(0);
  });
});

describe('FittingCache.invalidate', () => {
  it('returns true + drops the entry', () => {
    const cache = new FittingCache();
    cache.getPerPipe(makePipe({ id: 'x' }));
    expect(cache.invalidate('x')).toBe(true);
    expect(cache.stats().size).toBe(0);
  });

  it('returns false for missing id', () => {
    const cache = new FittingCache();
    expect(cache.invalidate('never-existed')).toBe(false);
  });
});

describe('FittingCache.clear', () => {
  it('wipes entries + stats', () => {
    const cache = new FittingCache();
    cache.getPerPipe(makePipe({ id: 'a' }));
    cache.clear();
    const s = cache.stats();
    expect(s.size).toBe(0);
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(0);
  });
});

// ── collectPerPipe ──────────────────────────────────────────

describe('FittingCache.collectPerPipe', () => {
  it('aggregates bend + flex fittings across pipes', () => {
    const cache = new FittingCache();
    const pipes = [
      makePipe({ id: 'a', points: [[0, 0, 0], [5, 0, 0], [5, 0, 5]] }),
      makePipe({ id: 'b', points: [[10, 0, 0], [15, 0, 0], [15, 0, 5]] }),
    ];
    const all = cache.collectPerPipe(pipes);
    // Each pipe has a 90° bend → 1 fitting each
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('prunes absent pipes automatically', () => {
    const cache = new FittingCache();
    cache.collectPerPipe([makePipe({ id: 'a' }), makePipe({ id: 'b' })]);
    expect(cache.stats().size).toBe(2);
    cache.collectPerPipe([makePipe({ id: 'a' })]); // dropped 'b'
    expect(cache.stats().size).toBe(1);
  });

  it('re-collect with same pipes is all hits', () => {
    const cache = new FittingCache();
    const pipes = [makePipe({ id: 'a' }), makePipe({ id: 'b' })];
    cache.collectPerPipe(pipes);
    cache.collectPerPipe(pipes);
    const s = cache.stats();
    expect(s.hits).toBe(2);
    expect(s.misses).toBe(2);
  });
});

// ── Singleton ───────────────────────────────────────────────

describe('getFittingCache()', () => {
  beforeEach(__resetFittingCache);

  it('returns the same instance across calls', () => {
    expect(getFittingCache()).toBe(getFittingCache());
  });

  it('__resetFittingCache creates a fresh instance', () => {
    const a = getFittingCache();
    __resetFittingCache();
    const b = getFittingCache();
    expect(a).not.toBe(b);
  });
});
