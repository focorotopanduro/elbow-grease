/**
 * mergePexRuns — Phase 7.B acceptance tests.
 *
 * Every case encodes a specific invariant of the merge logic:
 *
 *   • Two PEX pipes at 45° → merged into one group.
 *   • Two PEX pipes at 90° → two singletons (we want a fitting, not a merge).
 *   • Two PVC pipes at 45° → two singletons (rigid doesn't merge).
 *   • Two PEX pipes with different diameters → two singletons (reducer).
 *   • Three PEX pipes at a shared vertex → three singletons (tee).
 *   • Chain of 3+ PEX pipes at smooth bends → one merged group.
 *   • Closed PEX loop → no merge (bail safely).
 *   • Mixed input: merges what deserves merging, leaves the rest alone.
 */

import { describe, it, expect } from 'vitest';
import { mergePexRuns } from '../mergePexRuns';
import type { CommittedPipe } from '@store/pipeStore';
import type { Vec3 } from '@core/events';

// ── Fixture helpers ────────────────────────────────────────────

function pipe(
  id: string,
  points: Vec3[],
  material = 'pex',
  diameter = 1,
  system: CommittedPipe['system'] = 'cold_supply',
): CommittedPipe {
  return {
    id,
    points,
    diameter,
    material,
    system,
    color: '#00e5ff',
    visible: true,
    selected: false,
  };
}

// ── Merging cases ──────────────────────────────────────────────

describe('mergePexRuns — happy path', () => {
  it('two PEX pipes meeting at 45° → one merged group', () => {
    // A: (0,0,0) → (5,0,0)          (pointing +X)
    // B: (5,0,0) → (10,0,5)         (45° turn into +X+Z)
    const a = pipe('a', [[0, 0, 0], [5, 0, 0]]);
    const b = pipe('b', [[5, 0, 0], [10, 0, 5]]);
    const res = mergePexRuns([a, b]);

    const groupA = res.byPipeId.get('a')!;
    const groupB = res.byPipeId.get('b')!;
    expect(groupA).toBe(groupB); // same group reference
    expect(groupA.isMerged).toBe(true);
    expect(groupA.pipeIds).toEqual(expect.arrayContaining(['a', 'b']));
    expect(groupA.mergedPoints.length).toBeGreaterThanOrEqual(3);
  });

  it('chain of 3 PEX pipes at smooth bends → one merged group of 3', () => {
    const a = pipe('a', [[0, 0, 0], [5, 0, 0]]);
    const b = pipe('b', [[5, 0, 0], [10, 0, 5]]);  // 45° turn
    const c = pipe('c', [[10, 0, 5], [15, 0, 5]]); // 45° turn back
    const res = mergePexRuns([a, b, c]);

    const groupA = res.byPipeId.get('a')!;
    expect(groupA.pipeIds).toHaveLength(3);
    expect(groupA.isMerged).toBe(true);
    expect(groupA.mergedPoints.length).toBeGreaterThanOrEqual(4);
    // Merged polyline starts and ends at the terminal vertices.
    expect(groupA.mergedPoints[0]).toEqual([0, 0, 0]);
    expect(groupA.mergedPoints[groupA.mergedPoints.length - 1]).toEqual([15, 0, 5]);
  });
});

// ── No-merge cases ────────────────────────────────────────────

describe('mergePexRuns — non-merging', () => {
  it('two PEX pipes at 90° → two singletons (we want a fitting)', () => {
    const a = pipe('a', [[0, 0, 0], [5, 0, 0]]);
    const b = pipe('b', [[5, 0, 0], [5, 0, 5]]); // 90° turn
    const res = mergePexRuns([a, b]);
    expect(res.byPipeId.get('a')!.isMerged).toBe(false);
    expect(res.byPipeId.get('b')!.isMerged).toBe(false);
    expect(res.groups.size).toBe(2);
  });

  it('two rigid pipes (PVC) at 45° → two singletons', () => {
    const a = pipe('a', [[0, 0, 0], [5, 0, 0]], 'pvc_sch40');
    const b = pipe('b', [[5, 0, 0], [10, 0, 5]], 'pvc_sch40');
    const res = mergePexRuns([a, b]);
    expect(res.byPipeId.get('a')!.isMerged).toBe(false);
    expect(res.byPipeId.get('b')!.isMerged).toBe(false);
  });

  it('one PEX + one PVC sharing an endpoint → two singletons', () => {
    const a = pipe('a', [[0, 0, 0], [5, 0, 0]], 'pex');
    const b = pipe('b', [[5, 0, 0], [10, 0, 5]], 'pvc_sch40');
    const res = mergePexRuns([a, b]);
    expect(res.byPipeId.get('a')!.isMerged).toBe(false);
    expect(res.byPipeId.get('b')!.isMerged).toBe(false);
  });

  it('two PEX pipes with different diameters → two singletons (reducer)', () => {
    const a = pipe('a', [[0, 0, 0], [5, 0, 0]], 'pex', 1);
    const b = pipe('b', [[5, 0, 0], [10, 0, 5]], 'pex', 0.75);
    const res = mergePexRuns([a, b]);
    expect(res.byPipeId.get('a')!.isMerged).toBe(false);
    expect(res.byPipeId.get('b')!.isMerged).toBe(false);
  });

  it('two PEX pipes in different systems → two singletons', () => {
    const a = pipe('a', [[0, 0, 0], [5, 0, 0]], 'pex', 1, 'cold_supply');
    const b = pipe('b', [[5, 0, 0], [10, 0, 5]], 'pex', 1, 'hot_supply');
    const res = mergePexRuns([a, b]);
    expect(res.byPipeId.get('a')!.isMerged).toBe(false);
    expect(res.byPipeId.get('b')!.isMerged).toBe(false);
  });

  it('three PEX pipes sharing a vertex → no merge (tee)', () => {
    const a = pipe('a', [[0, 0, 0], [5, 0, 0]]);
    const b = pipe('b', [[5, 0, 0], [10, 0, 5]]);
    const c = pipe('c', [[5, 0, 0], [5, 0, 5]]); // third pipe at the shared vertex
    const res = mergePexRuns([a, b, c]);
    expect(res.byPipeId.get('a')!.isMerged).toBe(false);
    expect(res.byPipeId.get('b')!.isMerged).toBe(false);
    expect(res.byPipeId.get('c')!.isMerged).toBe(false);
  });
});

// ── Corner cases ──────────────────────────────────────────────

describe('mergePexRuns — corners', () => {
  it('empty input → empty maps', () => {
    const res = mergePexRuns([]);
    expect(res.byPipeId.size).toBe(0);
    expect(res.groups.size).toBe(0);
  });

  it('single pipe → one singleton group', () => {
    const a = pipe('a', [[0, 0, 0], [5, 0, 0]]);
    const res = mergePexRuns([a]);
    expect(res.byPipeId.get('a')!.isMerged).toBe(false);
    expect(res.groups.size).toBe(1);
  });

  it('closed PEX loop → safe fallback (singletons, no crash)', () => {
    // Four PEX pipes forming a square at 90° corners.
    // 90° corners should prevent merging — so we should NOT get a merged group.
    // Point of this test: the walker never has to traverse the loop.
    const a = pipe('a', [[0, 0, 0], [5, 0, 0]]);
    const b = pipe('b', [[5, 0, 0], [5, 0, 5]]);
    const c = pipe('c', [[5, 0, 5], [0, 0, 5]]);
    const d = pipe('d', [[0, 0, 5], [0, 0, 0]]);
    const res = mergePexRuns([a, b, c, d]);
    // 90° corners → no merging. All singletons.
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(res.byPipeId.get(id)!.isMerged).toBe(false);
    }
  });

  it('merged lead has the lowest-index pipe as the group lead', () => {
    // Insertion order shouldn't matter for correctness, but verifying
    // the lead is stable makes the renderer's memoization reliable.
    const a = pipe('a', [[0, 0, 0], [5, 0, 0]]);
    const b = pipe('b', [[5, 0, 0], [10, 0, 5]]);
    const res = mergePexRuns([a, b]);
    expect(res.byPipeId.get('a')!.leadPipeId).toBe('a');
    expect(res.byPipeId.get('b')!.leadPipeId).toBe('a');
  });
});

// ── Phase 7.B.ii: mergedVertices set ──────────────────────────

describe('mergePexRuns — mergedVertices set', () => {
  it('populates mergedVertices at smooth-bend shared endpoints', () => {
    const a = pipe('a', [[0, 0, 0], [5, 0, 0]]);
    const b = pipe('b', [[5, 0, 0], [10, 0, 5]]);
    const res = mergePexRuns([a, b]);
    // The shared vertex (5,0,0) smooth-bent, so it's in the set.
    expect(res.mergedVertices.size).toBeGreaterThan(0);
    // Build the expected key the same way mergePexRuns does.
    expect([...res.mergedVertices]).toContain('5.000,0.000,0.000');
  });

  it('does NOT include 90° vertices (those get real fittings)', () => {
    const a = pipe('a', [[0, 0, 0], [5, 0, 0]]);
    const b = pipe('b', [[5, 0, 0], [5, 0, 5]]); // 90°
    const res = mergePexRuns([a, b]);
    expect(res.mergedVertices.size).toBe(0);
  });

  it('does NOT include 3-way tee vertices (real fittings needed)', () => {
    const a = pipe('a', [[0, 0, 0], [5, 0, 0]]);
    const b = pipe('b', [[5, 0, 0], [10, 0, 5]]);
    const c = pipe('c', [[5, 0, 0], [5, 0, -5]]);
    const res = mergePexRuns([a, b, c]);
    expect(res.mergedVertices.size).toBe(0);
  });

  it('does NOT include rigid-material vertices', () => {
    const a = pipe('a', [[0, 0, 0], [5, 0, 0]], 'pvc_sch40');
    const b = pipe('b', [[5, 0, 0], [10, 0, 5]], 'pvc_sch40');
    const res = mergePexRuns([a, b]);
    expect(res.mergedVertices.size).toBe(0);
  });
});

// ── Mixed scenario ────────────────────────────────────────────

describe('mergePexRuns — mixed input', () => {
  it('merges only the pipes that deserve merging', () => {
    // Run 1: three PEX pipes at smooth bends → one merged group.
    const a = pipe('a', [[0, 0, 0], [5, 0, 0]]);
    const b = pipe('b', [[5, 0, 0], [10, 0, 5]]);
    const c = pipe('c', [[10, 0, 5], [15, 0, 5]]);
    // Run 2: two PVC pipes somewhere else — should stay singletons.
    const d = pipe('d', [[20, 0, 0], [25, 0, 0]], 'pvc_sch40');
    const e = pipe('e', [[25, 0, 0], [30, 0, 5]], 'pvc_sch40');
    // Run 3: one lone PEX pipe.
    const f = pipe('f', [[100, 0, 0], [105, 0, 0]]);

    const res = mergePexRuns([a, b, c, d, e, f]);

    // a/b/c merge
    expect(res.byPipeId.get('a')!.pipeIds).toHaveLength(3);
    expect(res.byPipeId.get('a')).toBe(res.byPipeId.get('b'));
    expect(res.byPipeId.get('a')).toBe(res.byPipeId.get('c'));

    // d/e don't merge
    expect(res.byPipeId.get('d')!.isMerged).toBe(false);
    expect(res.byPipeId.get('e')!.isMerged).toBe(false);

    // f is a lone singleton
    expect(res.byPipeId.get('f')!.isMerged).toBe(false);

    // Total unique groups: 1 merged + 2 singletons (d, e) + 1 (f) = 4
    expect(res.groups.size).toBe(4);
  });
});
