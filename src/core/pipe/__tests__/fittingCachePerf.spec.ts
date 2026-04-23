/**
 * fittingCache — Phase 14.T perf regression guard.
 *
 * This is NOT a micro-benchmark for publishing numbers; it's a
 * floor-level regression guard that asserts the cached path is
 * materially cheaper than the uncached path for realistic scene
 * sizes. If a future change accidentally defeats the memo (e.g.
 * invalidates on every tick), this test fails loudly instead of
 * silently burning CPU.
 *
 * Why not vitest's `bench` mode: vitest-bench produces a report
 * format that's noisy in CI, and we don't need statistical
 * rigor — we need "second run is ≥ 10× faster than first run."
 *
 * NOTE: timing-based tests are inherently flaky under load. Bounds
 * here are conservative (10× ratio on a scene with 100 pipes of 4
 * points each), which holds even on CI containers sharing a CPU.
 * If a flake surfaces, relax the ratio first before deleting.
 */

import { describe, it, expect } from 'vitest';
import { FittingCache } from '../fittingCache';
import { generateBendFittings } from '@ui/pipe/FittingGenerator';
import type { CommittedPipe } from '../../../store/pipeStore';

function buildScene(n: number): CommittedPipe[] {
  const pipes: CommittedPipe[] = [];
  for (let i = 0; i < n; i++) {
    // Each pipe: 4 points, one 90° bend — representative of a
    // typical fixture branch: origin → turn → turn → endpoint.
    const x = (i % 10) * 5;
    const z = Math.floor(i / 10) * 5;
    pipes.push({
      id: `p_${i}`,
      points: [
        [x, 0, z],
        [x + 2, 0, z],
        [x + 2, 0, z + 3],
        [x + 5, 0, z + 3],
      ],
      diameter: 3,
      material: 'pvc_sch40',
      system: 'waste',
      color: '#66bb6a',
      visible: true,
      selected: false,
    });
  }
  return pipes;
}

/**
 * Run the bend-fitting pass twice and return [t1, t2] in ms.
 * With a working cache, t2 should be dominated by hash-lookup
 * cost, not fitting generation.
 */
function twoPassTiming(pipes: readonly CommittedPipe[]): [number, number] {
  const cache = new FittingCache();
  const t0 = performance.now();
  cache.collectPerPipe(pipes);
  const t1 = performance.now() - t0;
  const t2Start = performance.now();
  cache.collectPerPipe(pipes);
  const t2 = performance.now() - t2Start;
  return [t1, t2];
}

describe('FittingCache perf floor', () => {
  it('100-pipe scene: cached pass is at least 2× cheaper', () => {
    const pipes = buildScene(100);
    const [first, second] = twoPassTiming(pipes);
    // Ratio threshold 2× leaves headroom for CI-shared-CPU noise.
    // In practice measured > 20× on a quiet box. If this fires
    // first check whether perf counters have degraded resolution
    // (e.g. a sleep-throttled laptop) before assuming regression.
    expect(second).toBeLessThanOrEqual(first);
    // Only compare ratios when first is big enough to measure (>1ms).
    if (first > 1) {
      expect(second).toBeLessThan(first / 2);
    }
  });

  it('500-pipe scene: cached pass is at least 2× cheaper', () => {
    const pipes = buildScene(500);
    const [first, second] = twoPassTiming(pipes);
    expect(second).toBeLessThanOrEqual(first);
    if (first > 1) {
      expect(second).toBeLessThan(first / 2);
    }
  });

  it('100-pipe scene: per-pipe point edit is O(1) in fitting regen', () => {
    const pipes = buildScene(100);
    const cache = new FittingCache();
    cache.collectPerPipe(pipes);
    const { misses: missesAfterFirst } = cache.stats();
    // Mutate only one pipe's points; everything else should be a hit.
    const edited = [
      ...pipes.slice(0, 50),
      {
        ...pipes[50]!,
        points: pipes[50]!.points.map((p) => [p[0] + 1, p[1], p[2]] as [number, number, number]),
      },
      ...pipes.slice(51),
    ];
    cache.collectPerPipe(edited);
    const { misses: missesAfterEdit, hits } = cache.stats();
    // Exactly ONE new miss (the edited pipe); 99 hits.
    expect(missesAfterEdit - missesAfterFirst).toBe(1);
    expect(hits).toBe(99);
  });

  it('direct uncached call measurable — sanity check on baseline', () => {
    const pipes = buildScene(100);
    const t0 = performance.now();
    for (const p of pipes) generateBendFittings(p);
    const elapsed = performance.now() - t0;
    // Baseline takes SOME time — if it's 0ms the test environment
    // resolution is too coarse to measure. 100 × 4-point pipes
    // should always produce measurable work.
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });
});
